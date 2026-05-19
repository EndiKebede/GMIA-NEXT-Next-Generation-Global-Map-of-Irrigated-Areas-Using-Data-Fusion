// ============================================================
// TILE-LEVEL RF PROBABILITY + ACCURACY + BEST THRESHOLD EXPORT
// Integrated clean version
//
// Logic:
// 1) Build AEZ predictor stack and cropland/valid-predictor mask.
// 2) Build export/training tiles and assign export_tile_id to GTPS.
// 3) Train one RF per tile when tile has enough training GTPS.
// 4) If tile has too few training GTPS, train using neighboring tiles.
// 5) If neighboring tiles still have too few GTPS, train using whole AEZ.
// 6) Export probability image for each tile.
// 7) Export one CSV containing per-tile accuracy metrics and the threshold
//    that maximizes accuracy for each tile.
// ============================================================


// Define the input variables

var aez_code_raw = 'AS_SubTropCoolH';

var predictors_folder = 'projects/udelgmia/assets/AS_AEZs';
var dist_river_asset = 'projects/ee-endikebede20223/assets/Dist_Asia_river';

var probability_asset_folder = 'projects/gmia-next/assets/As_Prediciton_Prob2';
var accuracy_drive_folder = 'GMIA_NEXT_ACCURACY';

var samples_asset_id =
  'projects/gmia-next/assets/Prediction_AS/AS_SubTropCoolH_rf_samples_merged';

var continental_samples_asset_id =
  'projects/gmia-next/assets/Prediction_AS/AS_allAEZ_rf_samples_merged';

var cropland_prob_asset = 'projects/remotesensinggi/assets/CLE_2020-24';
var cropland_prob_band = 'b1';
var cropland_threshold = 50;

// Spatial/group split settings
var split_train = 0.60;
var split_eval = 0.20;
var split_test = 0.20;
var seed = 42;

// samples to use for accuracy table: 'eval', 'test'
var accuracy_split = 'test';

// Export/model settings
var export_scale = 30;
var fill_value = -9999;
var vars_per_split_override = null;

// Minimum valid predictors
var min_valid_predictors_for_training = 6;
var min_valid_predictors_for_prediction = 6;

// Export probability style
// true  = uint8 0-100
// false = uint16 0-prob_scale_u16
var export_prob_uint8_0_100 = true;
var prob_scale_u16 = 10000;

// Tile grid settings
// This creates fixed tile count: cols * rows.
//  we used 5 * 2 = 10 tiles. Depeding on AEZ the size of tiles may vary
var grid_crs = 'EPSG:3857';
var export_tile_cols = 5;
var export_tile_rows = 2;
var max_export_tiles_per_run = 10;

// Optional single-tile mode
var export_single_tile = false;
var target_tile_id = 0;

// Training fallback rules
// A tile-specific model is used only when the tile has enough unique GTPS.
// Otherwise neighbor tiles are aggregated; if still insufficient, whole AEZ is used.
var min_train_total = 50;
var min_train_unique_farms = 50;
var min_train_per_class = 10;
var neighbor_tile_count = 5;  

// Threshold search that max accuracy 
var threshold_min = 0;
var threshold_max = 100;
var threshold_step = 1;
var fixed_threshold_for_reporting = 50;

// RF parameters
var TILE_RF_PARAMS = {
  numberOfTrees: 50,
  maxNodes: 128,
  minLeafPopulation: 2
};


// =========================
// 1) DYNAMIC PATHS
// =========================

var aez_code = String(aez_code_raw).replace(/_+$/, '');

var predictor_suffixes = [
  'ERA5_vapor_stats',
  'ET_sum_mm',
  'EVI_max',
  'EVI_mean',
  'EVI_min',
  'GI_max',
  'GI_mean',
  'GI_min',
  'NDWI_max',
  'NDWI_mean',
  'NDWI_min',
  'PET_sum_mm',
  "dust_to_canal",
  "LST",
  'SMAP_mean',
  'slope_deg'
];

function build_pred_asset_ids(aezCode, suffixes) {
  return suffixes.map(function(sfx) {
    return predictors_folder + '/' + aezCode + '_' + sfx;
  });
}

var pred_asset_ids = build_pred_asset_ids(aez_code, predictor_suffixes);

if (Math.abs((split_train + split_eval + split_test) - 1) > 1e-9) {
  throw new Error('split fractions must sum to 1.');
}

var n_export_tiles = export_tile_cols * export_tile_rows;
var n_tiles_to_make = Math.min(max_export_tiles_per_run, n_export_tiles);

var accuracy_csv_description =
  aez_code + '_tile_RF_accuracy_best_threshold_' + accuracy_split;


// Helper fucntions 

function var_name_from_asset_id(asset_id) {
  var base = asset_id.split('/').pop();
  var prefix = aez_code + '_';

  if (base.indexOf(prefix) !== 0) {
    throw new Error('Predictor asset does not start with aez_code_: ' + base);
  }

  return base.slice(prefix.length);
}

function prep_continuous_image(img) {
  return img.toFloat().resample('bilinear');
}

function load_one_predictor(asset_id) {
  var var_name = var_name_from_asset_id(asset_id);
  var img = prep_continuous_image(ee.Image(asset_id));
  var band_names = img.bandNames();

  var single = img.rename(var_name);

  var multi_names = band_names.map(function(b) {
    return ee.String(var_name).cat('_').cat(ee.String(b));
  });

  var multi = img.rename(multi_names);

  return ee.Image(ee.Algorithms.If(band_names.size().eq(1), single, multi));
}

function load_stack_from_asset_ids(asset_ids) {
  var imgs = asset_ids.map(function(id) {
    return load_one_predictor(id);
  });

  return ee.Image.cat(imgs).toFloat();
}

function make_rf_classifier(params, vps, output_mode) {
  params = ee.Dictionary(params);
  output_mode = output_mode || 'CLASSIFICATION';

  var n_trees = params.getNumber('numberOfTrees').toInt();
  var min_leaf = params.getNumber('minLeafPopulation').toInt();
  var max_nodes = params.getNumber('maxNodes').toInt();
  var vps_int = ee.Number(vps).toInt();

  var clf = ee.Classifier(ee.Algorithms.If(
    max_nodes.gt(0),
    ee.Classifier.smileRandomForest(
      n_trees, vps_int, min_leaf, 0.632, max_nodes, seed
    ),
    ee.Classifier.smileRandomForest(
      n_trees, vps_int, min_leaf, 0.632, null, seed
    )
  ));

  return clf.setOutputMode(output_mode);
}

function get_hist_count_numkey(fc, classValue) {
  var hist = ee.Dictionary(fc.aggregate_histogram('label'));
  var keyStr = ee.Number(classValue).format('%d');

  return ee.Number(
    ee.Algorithms.If(hist.contains(keyStr), hist.get(keyStr), 0)
  );
}

function count_classes_and_farms(fc) {
  return ee.Dictionary({
    n0: get_hist_count_numkey(fc, 0),
    n1: get_hist_count_numkey(fc, 1),
    total: fc.size(),
    unique_farms: fc.aggregate_count_distinct('farm_id_safe')
  });
}

function eligible_train_fc(fc) {
  var c = count_classes_and_farms(fc);

  return ee.Number(c.get('n0')).gte(min_train_per_class)
    .and(ee.Number(c.get('n1')).gte(min_train_per_class))
    .and(ee.Number(c.get('total')).gte(min_train_total))
    .and(ee.Number(c.get('unique_farms')).gte(min_train_unique_farms));
}

function add_group_split_from_coords(fc) {
  return fc.map(function(f) {
    var geom = f.geometry().transform('EPSG:3857', 1);
    var xy = geom.coordinates();

    var x = ee.Number(xy.get(0)).round().toInt64();
    var y = ee.Number(xy.get(1)).round().toInt64();

    // 45 m grid groups nearby points into a farm-like spatial unit.
    // This prevents neighboring points from being split across train/eval/test.
    var gx = x.divide(45).floor();
    var gy = y.divide(45).floor();
    var gid_safe = gx.multiply(100000000).add(gy).toInt64();

    var h = gid_safe.multiply(1103515245).add(seed);
    h = h.mod(2147483647);
    h = h.add(2147483647).mod(2147483647);

    var u = h.divide(2147483647);

    var split = ee.String(
      ee.Algorithms.If(
        u.lt(split_train),
        'train',
        ee.Algorithms.If(u.lt(split_train + split_eval), 'eval', 'test')
      )
    );

    return f.set({
      farm_id_safe: gid_safe,
      split: split,
      split_u: u
    });
  });
}

function make_grid_over_geom(geom, cols, rows, projCrs) {
  var proj = ee.Projection(projCrs);
  var geomProj = geom.transform(proj, 1);
  var bounds = geomProj.bounds(1, proj);

  var coords = ee.List(bounds.coordinates().get(0));

  var xs = coords.map(function(pt) {
    return ee.Number(ee.List(pt).get(0));
  });

  var ys = coords.map(function(pt) {
    return ee.Number(ee.List(pt).get(1));
  });

  var xmin = ee.Number(xs.reduce(ee.Reducer.min()));
  var xmax = ee.Number(xs.reduce(ee.Reducer.max()));
  var ymin = ee.Number(ys.reduce(ee.Reducer.min()));
  var ymax = ee.Number(ys.reduce(ee.Reducer.max()));

  var cell_w = xmax.subtract(xmin).divide(cols);
  var cell_h = ymax.subtract(ymin).divide(rows);

  var cells = [];

  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      var x0 = xmin.add(cell_w.multiply(c));
      var x1 = c === cols - 1 ? xmax : x0.add(cell_w);
      var y0 = ymin.add(cell_h.multiply(r));
      var y1 = r === rows - 1 ? ymax : y0.add(cell_h);

      var rect = ee.Geometry.Rectangle([x0, y0, x1, y1], proj, false)
        .intersection(geomProj, 1);

      cells.push(ee.Feature(rect, {
        export_tile_id: r * cols + c,
        tile_grid_id: aez_code + '_tile_' + String(r * cols + c),
        tile_row: r,
        tile_col: c,
        cell_area_m2: rect.area(1)
      }));
    }
  }

  return ee.FeatureCollection(cells)
    .filter(ee.Filter.gt('cell_area_m2', 0));
}

function attach_tile_id_to_points(fc, tilesFc) {
  return fc.map(function(f) {
    var hit = ee.Feature(tilesFc.filterBounds(f.geometry()).first());

    return ee.Feature(
      ee.Algorithms.If(
        hit,
        f.set({
          export_tile_id: hit.get('export_tile_id'),
          tile_grid_id: hit.get('tile_grid_id'),
          tile_row: hit.get('tile_row'),
          tile_col: hit.get('tile_col')
        }),
        f.set({
          export_tile_id: -9999,
          tile_grid_id: 'missing',
          tile_row: -9999,
          tile_col: -9999
        })
      )
    );
  }).filter(ee.Filter.neq('export_tile_id', -9999));
}

function safeDivide(num, den) {
  num = ee.Number(num);
  den = ee.Number(den);

  return ee.Algorithms.If(
    den.gt(0),
    num.divide(den),
    null
  );
}

function add_lon_lat(f) {
  var coords = f.geometry().coordinates();
  return f.set({lon: coords.get(0), lat: coords.get(1)});
}

function get_neighbor_tile_ids_client(tileId, cols, rows, k) {
  var r0 = Math.floor(tileId / cols);
  var c0 = tileId % cols;
  var ids = [];

  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      var id = r * cols + c;
      var manhattan = Math.abs(r - r0) + Math.abs(c - c0);
      var euclid2 = Math.pow(r - r0, 2) + Math.pow(c - c0, 2);
      ids.push({id: id, manhattan: manhattan, euclid2: euclid2});
    }
  }

  ids.sort(function(a, b) {
    if (a.manhattan !== b.manhattan) return a.manhattan - b.manhattan;
    if (a.euclid2 !== b.euclid2) return a.euclid2 - b.euclid2;
    return a.id - b.id;
  });

  return ids.slice(0, k).map(function(o) { return o.id; });
}

function select_accuracy_samples(samples) {
  if (accuracy_split === 'eval') {
    return samples.filter(ee.Filter.eq('split', 'eval'));
  }
  if (accuracy_split === 'test') {
    return samples.filter(ee.Filter.eq('split', 'test'));
  }
  if (accuracy_split === 'eval_test') {
    return samples.filter(ee.Filter.inList('split', ['eval', 'test']));
  }
  return samples;
}


// Feature engineering

var EXACT_ALIASES = {
  'dist_to_river': ['dist_riv', 'dist_river', 'distriver', 'dist_to_ri'],
  'dist_to_canal': ['dist_can', 'dist_Can'],
  'ET_sum_mm': ['et_sum', 'etsum'],
  'PET_sum_mm': ['pet_sum', 'petsum'],
  'slope_deg': ['slope', 'slopedeg'],
  'EVI_max': ['evi_max'],
  'EVI_mean': ['evi_mean'],
  'EVI_min': ['evi_min'],
  'GI_max': ['gi_max'],
  'GI_mean': ['gi_mean'],
  'GI_min': ['gi_min'],
  'LST': ['lst'],
  'NDWI_max': ['ndwi_max'],
  'NDWI_mean': ['ndwi_mean'],
  'NDWI_min': ['ndwi_min'],
  'SMAP_mean_SMAP_rootzone': ['smap_root', 'smap_rootz', 'smap_rootzone'],
  'SMAP_mean_SMAP_surface': ['smap_surf', 'smap_surface'],
  'ERA5_vapor_stats_svp_mean': ['era5_svp', 'svp_mean', 'svp'],
  'ERA5_vapor_stats_vpd_mean': ['era5_vpd', 'vpd_mean', 'vpd']
};

function uniqueArray(arr) {
  var out = [];

  for (var i = 0; i < arr.length; i++) {
    if (out.indexOf(arr[i]) === -1) {
      out.push(arr[i]);
    }
  }

  return out;
}

function firstAvailable(candidates, available) {
  for (var i = 0; i < candidates.length; i++) {
    if (available.indexOf(candidates[i]) !== -1) {
      return candidates[i];
    }
  }

  return null;
}

function candidatePropsForTarget(targetName) {
  var cands = [targetName];

  if (EXACT_ALIASES[targetName]) {
    cands = cands.concat(EXACT_ALIASES[targetName]);
  }

  if (targetName.indexOf('ERA5_vapor_stats_') === 0) {
    var suffix = targetName.replace('ERA5_vapor_stats_', '');
    cands.push('era5_' + suffix.toLowerCase());
    cands.push('era5_' + suffix.replace('_mean', '').toLowerCase());
    cands.push(suffix.toLowerCase());
    cands.push(suffix.replace('_mean', '').toLowerCase());
  }

  if (targetName.indexOf('SMAP_mean_') === 0) {
    var smapSuffix = targetName.replace('SMAP_mean_', '').toLowerCase();
    cands.push('smap_' + smapSuffix);
    cands.push(smapSuffix);
  }

  return uniqueArray(cands);
}

function add_valid_predictor_count(fc, predictorBands) {
  return fc.map(function(f) {
    var validCount = ee.Number(0);

    for (var i = 0; i < predictorBands.length; i++) {
      var band = predictorBands[i];
      var value = f.get(band);

      var isValid = ee.Algorithms.If(
        ee.Algorithms.IsEqual(value, null),
        0,
        ee.Algorithms.If(
          ee.Number(value).neq(fill_value),
          1,
          0
        )
      );

      validCount = validCount.add(ee.Number(isValid));
    }

    return f.set('valid_predictor_count', validCount);
  });
}

function resolveSampleSchema(rawSamples, predictorBandNamesClient, tagName) {
  var first = rawSamples.first();
  var propNames = ee.Feature(first).propertyNames().getInfo();

  var labelCandidates = ['irrigated', 'irrig', 'label'];
  var labelSource = firstAvailable(labelCandidates, propNames);

  if (!labelSource) {
    throw new Error(
      tagName + ': Could not find label field. Available properties: ' +
      JSON.stringify(propNames)
    );
  }

  var sourceProps = [];
  var targetProps = [];
  var missingTargets = [];

  for (var i = 0; i < predictorBandNamesClient.length; i++) {
    var target = predictorBandNamesClient[i];
    var candidates = candidatePropsForTarget(target);
    var source = firstAvailable(candidates, propNames);

    if (source) {
      sourceProps.push(source);
      targetProps.push(target);
    } else {
      missingTargets.push(target);
    }
  }

  if (missingTargets.length > 0) {
    throw new Error(
      tagName + ': Missing predictor properties: ' +
      JSON.stringify(missingTargets)
    );
  }

  var cleaned = rawSamples
    .filter(ee.Filter.notNull([labelSource]))
    .filter(ee.Filter.notNull(['.geo']))
    .select(
      sourceProps.concat([labelSource]),
      targetProps.concat(['label'])
    )
    .map(function(f) {
      return f.set('label', ee.Number(f.get('label')).toInt());
    })
    .filter(ee.Filter.inList('label', [0, 1]));

  cleaned = add_valid_predictor_count(cleaned, predictorBandNamesClient);

  return cleaned.filter(
    ee.Filter.gte('valid_predictor_count', min_valid_predictors_for_training)
  );
}


// =========================
// 4) LOAD PREDICTORS + MASKS
// =========================

var stack_raw = load_stack_from_asset_ids(pred_asset_ids);
var aez_geom = stack_raw.geometry(1);

var cropland_prob = ee.Image(cropland_prob_asset)
  .select(cropland_prob_band)
  .toFloat()
  .rename('cropland_prob')
  .clip(aez_geom);

var cropland_mask = cropland_prob
  .gt(cropland_threshold)
  .rename('cropland_mask')
  .selfMask();

stack_raw = stack_raw.clip(aez_geom);

var dist_river_raw = ee.Image(dist_river_asset)
  .select([0])
  .rename('dist_to_river')
  .toFloat()
  .resample('bilinear')
  .clip(aez_geom);

var predictors_raw = stack_raw
  .addBands(dist_river_raw)
  .toFloat()
  .clip(aez_geom);

var predictor_bands = predictors_raw.bandNames();
var predictor_bands_client = predictor_bands.getInfo();
var n_pred = predictor_bands.size();

var predictor_valid_count = predictors_raw.mask()
  .reduce(ee.Reducer.sum())
  .rename('predictor_valid_count');

var prediction_valid_mask = predictor_valid_count
  .gte(min_valid_predictors_for_prediction)
  .selfMask();

var modeling_mask = cropland_mask
  .and(prediction_valid_mask)
  .selfMask()
  .clip(aez_geom);

var predictors_for_model = predictors_raw
  .unmask(fill_value, false)
  .toFloat();

var vps = vars_per_split_override !== null &&
          vars_per_split_override !== undefined
  ? ee.Number(vars_per_split_override)
  : n_pred.sqrt().floor().max(1);


// =========================
// 5) BUILD TILE GRID
// =========================

var tile_fc = make_grid_over_geom(
  aez_geom,
  export_tile_cols,
  export_tile_rows,
  grid_crs
);

print('AEZ code:', aez_code);
print('Predictor bands:', predictor_bands);
print('Tile grid:', tile_fc);
print('Requested tile count:', n_export_tiles);
print('Valid intersecting tile count:', tile_fc.size());

Map.setOptions('SATELLITE');
Map.centerObject(aez_geom, 5);
Map.addLayer(tile_fc.style({color: 'red', fillColor: '00000000', width: 1}), {}, 'Tile grid', false);


// Loading local and Continental AEZ wide GTPs

var raw_local_fc = ee.FeatureCollection(samples_asset_id);

var local_samples_fc = resolveSampleSchema(
  raw_local_fc,
  predictor_bands_client,
  'LOCAL'
);

local_samples_fc = add_group_split_from_coords(local_samples_fc);
local_samples_fc = attach_tile_id_to_points(local_samples_fc, tile_fc).map(add_lon_lat);

var raw_continental_fc = ee.FeatureCollection(continental_samples_asset_id);

var continental_samples_fc = resolveSampleSchema(
  raw_continental_fc,
  predictor_bands_client,
  'CONTINENTAL'
);

continental_samples_fc = add_group_split_from_coords(continental_samples_fc);
continental_samples_fc = attach_tile_id_to_points(continental_samples_fc, tile_fc).map(add_lon_lat);

// For tile-specific models, use local AEZ samples first.
var local_train_all = local_samples_fc.filter(ee.Filter.eq('split', 'train'));
var local_accuracy_samples_all = select_accuracy_samples(local_samples_fc);

// Whole-AEZ fallback prefers local AEZ if eligible; otherwise continental AEZ.
var continental_train_all = continental_samples_fc.filter(ee.Filter.eq('split', 'train'));
var local_aez_train_ok = eligible_train_fc(local_train_all);

var whole_aez_train_fc = ee.FeatureCollection(
  ee.Algorithms.If(
    local_aez_train_ok,
    local_train_all,
    continental_train_all
  )
);

print('Local samples:', local_samples_fc.size());
print('Local train samples:', local_train_all.size());
print('Local train unique farms:', local_train_all.aggregate_count_distinct('farm_id_safe'));
print('Local tile histogram:', local_samples_fc.aggregate_histogram('export_tile_id'));
print('Whole AEZ fallback uses local if eligible:', local_aez_train_ok);


// Accurcy Metrics

function metrics_from_sampled(sampled, threshold) {
  threshold = ee.Number(threshold);

  var withPred = sampled.map(function(f) {
    var pred = ee.Number(f.get('prob_0_100')).gte(threshold).toInt();
    return f.set('pred', pred);
  });

  var TP = ee.Number(
    withPred
      .filter(ee.Filter.eq('label', 1))
      .filter(ee.Filter.eq('pred', 1))
      .size()
  );

  var FN = ee.Number(
    withPred
      .filter(ee.Filter.eq('label', 1))
      .filter(ee.Filter.eq('pred', 0))
      .size()
  );

  var FP = ee.Number(
    withPred
      .filter(ee.Filter.eq('label', 0))
      .filter(ee.Filter.eq('pred', 1))
      .size()
  );

  var TN = ee.Number(
    withPred
      .filter(ee.Filter.eq('label', 0))
      .filter(ee.Filter.eq('pred', 0))
      .size()
  );

  var total = TP.add(FN).add(FP).add(TN);

  return ee.Dictionary({
    threshold_0_100: threshold,
    TP: TP,
    FN: FN,
    FP: FP,
    TN: TN,
    total_confusion: total,
    accuracy: safeDivide(TP.add(TN), total),
    precision: safeDivide(TP, TP.add(FP)),
    recall_sensitivity: safeDivide(TP, TP.add(FN)),
    specificity: safeDivide(TN, TN.add(FP)),
    f1: safeDivide(
      ee.Number(2).multiply(TP),
      ee.Number(2).multiply(TP).add(FP).add(FN)
    )
  });
}

function best_threshold_feature(sampled) {
  var thresholds = ee.List.sequence(threshold_min, threshold_max, threshold_step);

  var thresholdFc = ee.FeatureCollection(thresholds.map(function(t) {
    var d = metrics_from_sampled(sampled, t);
    return ee.Feature(null, d);
  }));

  // Sort descending by accuracy, then f1, then recall. If tied, lower threshold remains acceptable.
  var best = ee.Feature(
    thresholdFc
      .sort('recall_sensitivity', false)
      .sort('f1', false)
      .sort('accuracy', false)
      .first()
  );

  return best;
}


// Train, Predict and Export per each Tiles

var accuracy_features = [];
var sampled_gtps_features = [];

for (var i = 0; i < n_tiles_to_make; i++) {
  if (export_single_tile && i !== target_tile_id) {
    continue;
  }

  var chosen_tile = ee.Feature(
    tile_fc.filter(ee.Filter.eq('export_tile_id', i)).first()
  );

  var chosen_geom = chosen_tile.geometry();
  var neighbor_ids_client = get_neighbor_tile_ids_client(
    i,
    export_tile_cols,
    export_tile_rows,
    neighbor_tile_count
  );

  // Local tile training candidates
  var tile_train_fc = local_train_all
    .filter(ee.Filter.eq('export_tile_id', i));

  var neighbor_train_fc = local_train_all
    .filter(ee.Filter.inList('export_tile_id', neighbor_ids_client));

  var tile_train_ok = eligible_train_fc(tile_train_fc);
  var neighbor_train_ok = eligible_train_fc(neighbor_train_fc);

  var final_train_fc = ee.FeatureCollection(
    ee.Algorithms.If(
      tile_train_ok,
      tile_train_fc,
      ee.Algorithms.If(
        neighbor_train_ok,
        neighbor_train_fc,
        whole_aez_train_fc
      )
    )
  );

  var training_source = ee.String(
    ee.Algorithms.If(
      tile_train_ok,
      'tile_only',
      ee.Algorithms.If(neighbor_train_ok, 'neighbor_tiles', 'whole_aez')
    )
  );

  var train_counts = count_classes_and_farms(final_train_fc);

  var prob_clf = make_rf_classifier(
    ee.Dictionary(TILE_RF_PARAMS),
    vps,
    'MULTIPROBABILITY'
  ).train({
    features: final_train_fc,
    classProperty: 'label',
    inputProperties: predictor_bands
  });

  var tile_model_mask = modeling_mask
    .clip(chosen_geom)
    .selfMask();

  var tile_predictors_for_model = predictors_for_model
    .clip(chosen_geom)
    .toFloat();

  var prob_arr = tile_predictors_for_model
    .classify(prob_clf)
    .clip(chosen_geom);

  var prob_all = prob_arr.arrayFlatten([['prob_0', 'prob_1']]);

  var prob_float_img = prob_all
    .select('prob_1')
    .rename('prob')
    .updateMask(tile_model_mask)
    .clip(chosen_geom);

  var prob_export_img = ee.Image(
    ee.Algorithms.If(
      export_prob_uint8_0_100,
      prob_float_img
        .clamp(0, 1)
        .multiply(100)
        .round()
        .toUint8()
        .rename('prob_0_100'),
      prob_float_img
        .clamp(0, 1)
        .multiply(prob_scale_u16)
        .round()
        .toUint16()
        .rename('prob_u16')
    )
  );

  var prob_0_100_for_accuracy = prob_float_img
    .clamp(0, 1)
    .multiply(100)
    .rename('prob_0_100');

  // Accuracy samples are always local AEZ held-out samples for that tile.
  var tile_eval_samples_raw = local_accuracy_samples_all.filterBounds(chosen_geom);
  var n_points_tile = tile_eval_samples_raw.size();

  var sampled_eval = prob_0_100_for_accuracy.sampleRegions({
    collection: tile_eval_samples_raw,
    properties: [
      'label',
      'split',
      'farm_id_safe',
      'export_tile_id',
      'tile_grid_id',
      'tile_row',
      'tile_col',
      'lon',
      'lat'
    ],
    scale: export_scale,
    geometries: false,
    tileScale: 4
  }).filter(ee.Filter.notNull(['prob_0_100', 'label']));

  var n_sampled = sampled_eval.size();
  var n_missing_prediction = n_points_tile.subtract(n_sampled);

  var fixed_metrics = metrics_from_sampled(sampled_eval, fixed_threshold_for_reporting);
  var best_threshold = best_threshold_feature(sampled_eval);

  var out_desc_prob = aez_code + '_TILE_RF_prob_tile_' + i;
  var out_asset_prob = probability_asset_folder + '/' + out_desc_prob;

  Export.image.toAsset({
    image: prob_export_img,
    description: out_desc_prob,
    assetId: out_asset_prob,
    region: chosen_geom,
    scale: export_scale,
    maxPixels: 1e13,
    pyramidingPolicy: {
      '.default': 'sample'
    }
  });

  var accFeature = ee.Feature(null, {
    aez_code: aez_code,
    export_tile_id: i,
    tile_grid_id: chosen_tile.get('tile_grid_id'),
    tile_row: chosen_tile.get('tile_row'),
    tile_col: chosen_tile.get('tile_col'),
    neighbor_tile_ids: neighbor_ids_client.join(','),
    training_source: training_source,

    train_total: train_counts.get('total'),
    train_unique_farms: train_counts.get('unique_farms'),
    train_n0: train_counts.get('n0'),
    train_n1: train_counts.get('n1'),
    tile_train_ok: tile_train_ok,
    neighbor_train_ok: neighbor_train_ok,

    accuracy_split: accuracy_split,
    n_points_tile: n_points_tile,
    n_sampled: n_sampled,
    n_missing_prediction: n_missing_prediction,

    fixed_threshold_0_100: fixed_threshold_for_reporting,
    fixed_TP: fixed_metrics.get('TP'),
    fixed_FN: fixed_metrics.get('FN'),
    fixed_FP: fixed_metrics.get('FP'),
    fixed_TN: fixed_metrics.get('TN'),
    fixed_total_confusion: fixed_metrics.get('total_confusion'),
    fixed_accuracy: fixed_metrics.get('accuracy'),
    fixed_precision: fixed_metrics.get('precision'),
    fixed_recall_sensitivity: fixed_metrics.get('recall_sensitivity'),
    fixed_specificity: fixed_metrics.get('specificity'),
    fixed_f1: fixed_metrics.get('f1'),

    best_threshold_0_100: best_threshold.get('threshold_0_100'),
    best_TP: best_threshold.get('TP'),
    best_FN: best_threshold.get('FN'),
    best_FP: best_threshold.get('FP'),
    best_TN: best_threshold.get('TN'),
    best_total_confusion: best_threshold.get('total_confusion'),
    best_accuracy: best_threshold.get('accuracy'),
    best_precision: best_threshold.get('precision'),
    best_recall_sensitivity: best_threshold.get('recall_sensitivity'),
    best_specificity: best_threshold.get('specificity'),
    best_f1: best_threshold.get('f1')
  });

  accuracy_features.push(accFeature);

  // Optional useful output: sampled GTPS probability table for threshold diagnostics.
  sampled_gtps_features.push(
    sampled_eval.map(function(f) {
      return f.set({
        aez_code: aez_code,
        model_tile_id: i,
        model_tile_grid_id: chosen_tile.get('tile_grid_id'),
        training_source: training_source
      });
    })
  );

  print('Created probability export task for tile:', i, out_desc_prob);
  print('Tile training source:', i, training_source);
  print('Tile neighbor ids:', i, neighbor_ids_client);
}


// Export accuracy metrcis and best threshold that convert prob to bianry

var perTileAccuracy = ee.FeatureCollection(accuracy_features);

print('Per-tile accuracy and best threshold:', perTileAccuracy);

Export.table.toDrive({
  collection: perTileAccuracy,
  description: accuracy_csv_description,
  folder: accuracy_drive_folder,
  fileNamePrefix: accuracy_csv_description,
  fileFormat: 'CSV',
  selectors: [
    'aez_code',
    'accuracy_split',
    'export_tile_id',
    'tile_grid_id',
    'tile_row',
    'tile_col',
    'neighbor_tile_ids',
    'training_source',

    'train_total',
    'train_unique_farms',
    'train_n0',
    'train_n1',
    'tile_train_ok',
    'neighbor_train_ok',

    'n_points_tile',
    'n_sampled',
    'n_missing_prediction',

    'fixed_threshold_0_100',
    'fixed_TP',
    'fixed_FN',
    'fixed_FP',
    'fixed_TN',
    'fixed_total_confusion',
    'fixed_accuracy',
    'fixed_precision',
    'fixed_recall_sensitivity',
    'fixed_specificity',
    'fixed_f1',

    'best_threshold_0_100',
    'best_TP',
    'best_FN',
    'best_FP',
    'best_TN',
    'best_total_confusion',
    'best_accuracy',
    'best_precision',
    'best_recall_sensitivity',
    'best_specificity',
    'best_f1'
  ]
});


// This is a safeguard to valdiate the threhsold outside GEE by extarcting probability for each test split GTPS

var export_sampled_gtps_probability_csv = true;

if (export_sampled_gtps_probability_csv) {
  var sampled_gtps_probability = ee.FeatureCollection(sampled_gtps_features).flatten();

  Export.table.toDrive({
    collection: sampled_gtps_probability,
    description: aez_code + '_GTPS_sampled_probability_by_tile_model_' + accuracy_split,
    folder: accuracy_drive_folder,
    fileNamePrefix: aez_code + '_GTPS_sampled_probability_by_tile_model_' + accuracy_split,
    fileFormat: 'CSV',
    selectors: [
      'aez_code',
      'model_tile_id',
      'model_tile_grid_id',
      'training_source',
      'export_tile_id',
      'tile_grid_id',
      'tile_row',
      'tile_col',
      'split',
      'farm_id_safe',
      'label',
      'prob_0_100',
      'lon',
      'lat'
    ]
  });
}

print('Done. Start the image export tasks and table export tasks from the Tasks tab.');

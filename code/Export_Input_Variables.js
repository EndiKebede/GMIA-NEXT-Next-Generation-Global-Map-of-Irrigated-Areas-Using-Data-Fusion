/************************************************************
Exports seasonal environmental predictor layers for a single Agro-Ecological Zone (AEZ).
The script masks all outputs to cropland within the selected AEZ and computes seasonal
vegetation indices from Landsat 8/9, evapotranspiration and potential evapotranspiration
from MODIS, daytime land surface temperature from MODIS Aqua, surface and root-zone soil
moisture from SMAP, elevation and slope from SRTM, temperature statistics from CHIRTS,
and vapor pressure variables derived from ERA5-Land. Each predictor is exported
individually to Google Earth Engine Assets for subsequent irrigation mapping.
 ************************************************************/
// Growing Season

var START = '2023-05-01';
var END   = '2024-09-30';

// AEZ short code
var AEZ_CODE   = 'AF_AmpleIrrSoil';
var SEASON_TAG = 'AprOct2023';

var AEZ_ASSET  = 'projects/ee-endikebede20223/assets/AF_AmpleIrrSoil';
var CROPLAND   = 'projects/ee-endikebede20223/assets/CLE_2024';

// Output folder in Assets 
var OUT_FOLDER  = 'projects/ee-endikebede20223/assets/AEZs';
var NAME_PREFIX = AEZ_CODE + '_';


// AEZ + CROPLAND MASK

var aezFC  = ee.FeatureCollection(AEZ_ASSET);
var region = aezFC.geometry();

// AEZ mask raster
var aezMask = ee.Image().byte().paint(aezFC, 1).eq(1).selfMask();

// Cropland mask raster 
var cropMask = ee.Image(CROPLAND).gt(0).selfMask();

// Combined target mask: AEZ AND Cropland
var targetMask = aezMask.and(cropMask).selfMask();

//visual checks
Map.centerObject(aezFC, 7);
Map.addLayer(cropMask,   {min: 0, max: 1, palette: ['000000', '00ff00']}, 'cropMask');
Map.addLayer(targetMask, {min: 0, max: 1, palette: ['000000', 'ffff00']}, 'AEZ ∩ Cropland');

// Apply final mask
function finalize(img) {
  img = ee.Image(img);
  var nb = img.bandNames().size();
  return ee.Image(ee.Algorithms.If(
    nb.gt(0),
    img.updateMask(targetMask).toFloat(),
    img 
  ));
}
function uniq(name) {
  return NAME_PREFIX + name; 
}

// LANDSAT 8/9 (C02 L2)
function maskLandsat(img) {
  var qa = img.select('QA_PIXEL');

  // Strict mask: bits 0-5 all 0
  var mask = qa.bitwiseAnd(1 << 0).eq(0)
    .and(qa.bitwiseAnd(1 << 1).eq(0))
    .and(qa.bitwiseAnd(1 << 2).eq(0))
    .and(qa.bitwiseAnd(1 << 3).eq(0))
    .and(qa.bitwiseAnd(1 << 4).eq(0))
    .and(qa.bitwiseAnd(1 << 5).eq(0));

  // Scale SR
  var sr = img.select(['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7'])
    .multiply(2.75e-5).add(-0.2)
    .clamp(0, 1);

  return sr.updateMask(mask);
}

function addVI(img) {
  var red   = img.select('SR_B4');
  var nir   = img.select('SR_B5');
  var blue  = img.select('SR_B2');
  var green = img.select('SR_B3');
  var swir  = img.select('SR_B6');

  var ndvi = nir.subtract(red).divide(nir.add(red)).rename('NDVI');
  var ndwi = nir.subtract(swir).divide(nir.add(swir)).rename('NDWI');
  var gi   = green.divide(red).rename('GI');

  // EVI = 2.5 * (NIR - RED) / (NIR + 6*RED - 7.5*BLUE + 1)
  var evi = nir.subtract(red).multiply(2.5)
    .divide(nir.add(red.multiply(6)).subtract(blue.multiply(7.5)).add(1))
    .rename('EVI');

  return img.addBands([ndvi, ndwi, gi, evi]);
}

var landsat = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
  .filterDate(START, END)
  .filterBounds(region)
  .map(maskLandsat)
  .map(addVI);

// Seasonal stats
var viStats = landsat.select(['NDVI','NDWI','GI','EVI']).reduce(
  ee.Reducer.mean()
    .combine(ee.Reducer.min(), '', true)
    .combine(ee.Reducer.max(), '', true)
);

// ---- VCI (Vegetation Condition Index) computed from seasonal NDVI range
// VCI = (NDVI_mean - NDVI_min) / (NDVI_max - NDVI_min)
var ndviMean  = viStats.select('NDVI_mean');
var ndviMin   = viStats.select('NDVI_min');
var ndviMax   = viStats.select('NDVI_max');
var ndviRange = ndviMax.subtract(ndviMin);

var vci = ndviMean.subtract(ndviMin)
  .divide(ndviRange.where(ndviRange.eq(0), 1))
  .clamp(0, 1)
  .rename('VCI');

// SMAP Soil Moisture (mean both bands)
var smapMean = ee.ImageCollection('NASA/SMAP/SPL4SMGP/008')
  .filterDate(START, END)
  .filterBounds(region)
  .select(['sm_surface','sm_rootzone'])
  .mean()
  .rename(['SMAP_surface','SMAP_rootzone']);

// MODIS ET / PET 
var etPet = ee.ImageCollection('MODIS/061/MOD16A2GF')
  .filterDate(START, END)
  .filterBounds(region)
  .select(['ET','PET'])
  .sum()
  .multiply(0.1)
  .rename(['ET_mm','PET_mm']);


// DEM + Slope

var dem   = ee.Image('USGS/SRTMGL1_003').select('elevation').rename('elevation_m');
var slope = ee.Terrain.slope(dem).rename('slope_deg');

// CHIRTS Temperature 
var chirtsStats = ee.ImageCollection('UCSB-CHG/CHIRTS/DAILY')
  .filterDate(START, END)
  .filterBounds(region)
  .select(['Tmax','Tmin'])
  .reduce(
    ee.Reducer.mean()
      .combine(ee.Reducer.min(), '', true)
      .combine(ee.Reducer.max(), '', true)
  );

// ERA5 Vapor Pressure stats
var era5 = ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR')
  .filterDate(START, END)
  .filterBounds(region);

function addVaporBands(img) {
  var tmax  = img.select('temperature_2m_max').subtract(273.15);
  var tmin  = img.select('temperature_2m_min').subtract(273.15);
  var td    = img.select('dewpoint_temperature_2m').subtract(273.15);
  var tmean = tmax.add(tmin).divide(2);

  var svp = ee.Image(0.6108).multiply(
    tmean.multiply(17.27).divide(tmean.add(237.3)).exp()
  ).rename('svp');

  var ea = ee.Image(0.6108).multiply(
    td.multiply(17.27).divide(td.add(237.3)).exp()
  );

  var vpd = svp.subtract(ea).rename('vpd');

  return img.addBands([svp, vpd]);
}
// MODIS LST
var lst = ee.ImageCollection('MODIS/061/MYD11A2')
  .filterDate(START, END)
  .filterBounds(region)
  .select('LST_Day_1km')
  .mean()
  .multiply(0.02)
  .subtract(273.15)
  .rename('LST_mean_C');
  
var vaporImg = era5
  .map(addVaporBands)
  .select(['svp','vpd'])
  .mean()
  .rename(['svp_mean','vpd_mean']);


// EXPORT (to Asset)
function exportAsset(img, shortName, scale) {
  var name = uniq(shortName);
  var out  = finalize(img);
  var nb   = out.bandNames().size();

  nb.evaluate(function(nBands){
    if (nBands === 0) {
      print('SKIP (0 bands):', name);
      return;
    }
    Export.image.toAsset({
      image: out,                    
      description: name,
      assetId: OUT_FOLDER + '/' + name,
      region: region,
      scale: scale,
      maxPixels: 1e13
    });
  });
}

// EXPORTS
var exportList = [
  // Landsat seasonal stats
  {img: viStats.select('NDVI_mean'), name:'NDVI_mean', scale:30},
  {img: viStats.select('NDVI_min'),  name:'NDVI_min',  scale:30},
  {img: viStats.select('NDVI_max'),  name:'NDVI_max',  scale:30},

  {img: viStats.select('EVI_mean'),  name:'EVI_mean',  scale:30},
  {img: viStats.select('EVI_min'),   name:'EVI_min',   scale:30},
  {img: viStats.select('EVI_max'),   name:'EVI_max',   scale:30},

  {img: viStats.select('NDWI_mean'), name:'NDWI_mean', scale:30},
  {img: viStats.select('NDWI_min'),  name:'NDWI_min',  scale:30},
  {img: viStats.select('NDWI_max'),  name:'NDWI_max',  scale:30},

  {img: viStats.select('GI_mean'),   name:'GI_mean',   scale:30},
  {img: viStats.select('GI_min'),    name:'GI_min',    scale:30},
  {img: viStats.select('GI_max'),    name:'GI_max',    scale:30},

  // VCI
  {img: vci, name:'VCI', scale:30},
  
  // MODIS LST
  {img: lst, name:'LST_mean_C', scale:1000},
  
  // MODIS ET/PET
  {img: etPet.select('ET_mm'),  name:'ET_sum_mm',  scale:500},
  {img: etPet.select('PET_mm'), name:'PET_sum_mm', scale:500},

  // DEM
  {img: dem,   name:'elevation_m', scale:30},
  {img: slope, name:'slope_deg',   scale:30},

  // Multi-band exports
  {img: smapMean,     name:'SMAP_mean',         scale:10000},
  {img: chirtsStats,  name:'CHIRTS_temp_stats', scale:5000},
  {img: vaporImg,     name:'ERA5_vapor_stats',  scale:10000}
];

exportList.forEach(function(e){
  exportAsset(e.img, e.name, e.scale);
});

// Debug layer
Map.addLayer(finalize(viStats.select('NDVI_mean')), {min:0, max:1}, 'NDVI_mean masked');

print('Cropland pixels (masked):', cropMask.reduceRegion({
  reducer: ee.Reducer.count(),
  geometry: region,
  scale: 30,
  maxPixels: 1e13
}));

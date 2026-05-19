var gaulLvl0 = ee.FeatureCollection("FAO/GAUL/2015/level0"),
    gaulLvl1 = ee.FeatureCollection("FAO/GAUL/2015/level1"),
    landsat8 = ee.ImageCollection("LANDSAT/LC08/C02/T1"),
    cropNE = ee.Image("your/path"),
    cropNW = ee.Image("your/path"),
    cropSE = ee.Image("your/path"),
    cropSW = ee.Image("your/path"),
    northAmericaPts = ee.FeatureCollection("your/path"),
    southAmericaPts = ee.FeatureCollection("your/path"),
    europePts = ee.FeatureCollection("your/path"),
    africaPts = ee.FeatureCollection("your/path"),
    oceaniaPts = ee.FeatureCollection("your/path");

// Code to run in Google Earth Engine (GEE) to generate ML results on irrigated areas for region of interest
// Author(s): Gabriel Laboy
// Last Updated: 08/06/2024

// Note that this currently only works with NDVI data compiled on a two month basis for image completeness.
// Ground truth point data used in this script can be found on the Drive and imported here.

/**
 * Retrieves geometry from a shapefile for a region of interest.
 * 
 * This function pulls the geometry from a shapefile for a specified country
 * and/or division from the GAUL Level 0 and Level 1 datasets.
 * 
 * @param {String} country  Name of the UN recognized country.
 * @param {String} division Name of the UN recognized administrative Level 1 division of the country.
 * 
 * @return {Geometry} A geometry object with the bounds of the specified region of interest.
 */
function getShapeForROI(country, division)  {
  if (division === '') {
    return gaulLvl0.filterMetadata('ADM0_NAME','equals',country).first().geometry();
  }
  else {
    return gaulLvl1.filterMetadata('ADM0_NAME','equals',country).filterMetadata('ADM1_NAME','equals',division).first().geometry();
  }
}

/**
 * Computes NDVI from composited satellite images.
 * 
 * Computes NDVI from composited satelllite images within a specified 
 * date range, bounds, and a crop mask. The satellite images used
 * are Landsat 8 Collection 2 Tier 1 images.
 * 
 * @param {Geometry} bounds    Region of interest to clip satellite images to.
 * @param {Image}    cropMask  A mask of cropland in region of interest to compute data in.
 * @param {String}   startDate Start date to filter satellite images collected.
 * @param {String}   endDate   End date to filter satellite images collected.
 * @param {String}   desc      Suffix to band description of NDVI image computed.
 * 
 * @return {Image} Computed NDVI image.
 */
function computeNDVI(bounds, cropMask, startDate, endDate, desc) {
  // Create composite with simpleComposite function to minimize cloud cover
  var composite = ee.Algorithms.Landsat.simpleComposite({
    collection: landsat8.filterBounds(bounds).filterDate(startDate,endDate),
    asFloat: true
  }).updateMask(cropMask).clip(bounds);
  
  // Compute NDVI from composited images and return
  return composite.normalizedDifference(['B5', 'B4']).rename('ndvi'+desc);
}

/**
 * Creates a prediction and probability map for irrigated area.
 * 
 * This function uses NDVI data along with ground truth points on irrigated area
 * to produce a true/false and probability maps of an area within each pixel being
 * irrigated. NDVI data is compiled by two month periods for 2023, and final maps
 * are produced within a region of interest.
 * 
 * @param {Geometry}          roi   Region to generate results in.
 * @param {FeatureCollection} gtPts Ground truth points to use for training and validation.
 */
function generateMapForRegion(roi, gtPts) {
  // Dates for 2023 organized in order from Jan to Dec and first to last day of each month
  var dates = ['2023-01-01','2023-01-31','2023-02-01','2023-02-27','2023-03-01','2023-03-31','2023-04-01','2023-04-30',
               '2023-05-01','2023-05-31','2023-06-01','2023-06-30','2023-07-01','2023-07-31','2023-08-01','2023-08-31',
               '2023-09-01','2023-09-30','2023-10-01','2023-10-31','2023-11-01','2023-11-30','2023-12-01','2023-12-31'];
  
  // Compile NDVI data by two month periods
  var ndviJanFeb = computeNDVI(roi, cropMask, dates[0], dates[3], 'JanFeb');
  var ndviMarApr = computeNDVI(roi, cropMask, dates[4], dates[7], 'MarApr');
  var ndviMayJun = computeNDVI(roi, cropMask, dates[8], dates[11], 'MayJun');
  var ndviJulAug = computeNDVI(roi, cropMask, dates[12], dates[15], 'JulAug');
  var ndviSepOct = computeNDVI(roi, cropMask, dates[6], dates[19], 'SepOct');
  var ndviNovDec = computeNDVI(roi, cropMask, dates[20], dates[23], 'NovDec');
  
  // Put all data together into single image as seperate bands
  var fusion = ndviJanFeb.addBands([ndviMarApr, ndviMayJun, ndviJulAug, ndviSepOct, ndviNovDec]);
  
  // Create and sample training points from ground truth
  var points = ee.FeatureCollection(gtPts.filterBounds(roi), 'geometry');
  var training = fusion.sampleRegions(points, ['irrigated']);
  
  // Train RF algorithm with NDVI data
  var classifier = ee.Classifier.smileRandomForest(10).train({
    features: training,
    classProperty: 'irrigated',  
    inputProperties: fusion.bandNames()
  });
  
  // Run RF algorithm
  var classified = fusion.classify(classifier);
  
  // Print out model accuracy
  var trainAccuracy = classifier.confusionMatrix();
  print('Resubstitution error matrix: ', trainAccuracy);
  print('Training overall accuracy: ', trainAccuracy.accuracy());
  
  // Add model as layer
  Map.addLayer(classified, {min: 0, max: 1, palette: ['orange', 'blue']}, 'Predicition Map');
  
  // Train and run RF model with probability output
  var classifierP = ee.Classifier.smileRandomForest(10).train({
    features: training,
    classProperty: 'irrigated',  
    inputProperties: fusion.bandNames()
  }).setOutputMode('PROBABILITY');
  var classifiedP = fusion.classify(classifierP);
  
  // Add probability model as layer
  Map.addLayer(classifiedP, {min: 0, max: 1, palette: ['white', 'blue']}, 'Probability Map');
}



// Updates these variables to change location of interest
var cntry = 'United States of America';
var div = 'Kansas';

// Get shape for region of interest
var roiShape = getShapeForROI(cntry, div);

// Mosaic together crop mask and add layer
var cropMask = ee.ImageCollection([cropNE,cropNW,cropSE,cropSW]).mosaic();
Map.addLayer(cropMask.updateMask(cropMask).clip(roiShape), {palette: ['red']}, 'Cropland');

// Run function to generate results
generateMapForRegion(roiShape, northAmericaPts);
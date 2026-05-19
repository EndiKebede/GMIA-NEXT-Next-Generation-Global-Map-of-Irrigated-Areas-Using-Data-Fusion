var aez = ee.Image("projects/glaboy-irrigation-mapping/assets/aez"),
    cropNE = ee.Image("projects/glaboy-irrigation-mapping/assets/cropNE"),
    cropNW = ee.Image("projects/glaboy-irrigation-mapping/assets/cropNW"),
    cropSE = ee.Image("projects/glaboy-irrigation-mapping/assets/cropSE"),
    cropSW = ee.Image("projects/glaboy-irrigation-mapping/assets/cropSW"),
    continents = ee.FeatureCollection("projects/glaboy-irrigation-mapping/assets/continents");

// Code to run in Google Earth Engine (GEE) to create the random point distribution for unbiased evaluation of ground truth.
// Author(s): Gabriel Laboy
// Last Updated: 7/31/2024

// This will take some time to run due to the multiple conversions of images to shapefiles and computation of areas to 
// determine the number of random points to create.
// Also note that in GEE you must import the necessary data locally as seen from the variables above in order to run this code.
// The data that needs to be imported can be found in the documentation on ground truth collection.

/**
 * Converts a specified AEZ region from an image (GeoTIFF) to a shapefile.
 *
 * This function utilizes GEE's reduceToVectors() function to convert an AEZ region
 * from the GAEZ dataset in GeoTIFF format to a Shapefile. The AEZ selection is determined
 * by the integer ID of the AEZ of interest.
 *
 * @param {Image}  aezImage Original AEZ image file (a GeoTIFF) containing all AEZs.
 * @param {Int}    aezID    The integer ID of the AEZ from the file to extract.
 *
 * @param {Table} The vectorized form (shapefile) of the AEZ region.
 */
function convertAEZtoShapefile(aezImage, aezID) {
  // Only pull data for the aez of interest (specified by aezID)
  var roi = aezImage.updateMask(aezImage.eq(aezID));
  
  // Reduce the image to vectors within continental landmass bounds
  var aezShape = roi.reduceToVectors({
    geometry: continents.geometry()
  });
  
  return aezShape;
}

/**
 * Creates a set of random points within a specified AEZ.
 * 
 * This function creates a set of randomly distributed points within a specified AEZ where
 * point count is determined by the area of cropland within the AEZ. A few items to note:
 *   
 *   1) The cropland data was upscaled to 5km due to computational resource limitations
 *   2) The equation to determine the number of points is: 
 *        Number of Points = Area of Cropland within AEZ (in square meters) / 5000
 *   3) Due to upscaling the cropland resolution, some points may fall outside 
 *      (but in close proximity) to the original cropland mask
 * 
 * @param {Image} An image (GeoTIFF) showing global cropland.
 * @param {Table} A shapefile representing the area of an AEZ.
 * 
 * @return {Table} A set of geometric points.
 */
function generateRandomPoints(cropImage, aezShape) {
  // Get cropland data within the agro-ecological zone of interest
  var cropAgroMask = cropImage.mask(cropImage.eq(1)).clip(aezShape);
  
  // Reduce the masked cropland data to vectors and extract the geometry
  var cropAgroShape = cropAgroMask.reduceToVectors({geometry: aezShape.geometry(), scale: 5000, bestEffort: true}).geometry();
  
  // Compute number of random points to make based off area and generate them within bounds of cropland
  var numPoints = cropAgroShape.area({maxError: 1}).divide(1e6).divide(5e3).toInt();
  var randomPoints = ee.FeatureCollection.randomPoints({region: cropAgroShape, points: numPoints, seed: 0, maxError: 1});
  
  return randomPoints;
}

// Create mosaic of all regional cropland files
var cropMosaic = ee.ImageCollection([cropNW, cropNE, cropSW, cropSE]).mosaic();

// Execute code to generate random points for all AEZ regions of interest
// Regions from the AEZ map not included are Water, Boreal, and Artic due to a lack of cropland within those areas
var rp1 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 1)); // Tropics Lowland Semi-arid
var rp2 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 2)); // Tropics Lowland Semi-humid
var rp3 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 3)); // Tropics Lowland Humid
var rp4 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 4)); // Tropics Highland Semi-arid
var rp5 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 5)); // Tropics Highland Semi-humid
var rp6 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 6)); // Tropics Highland Humid
var rp7 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 7)); // Sub-tropics Warm Semi-arid
var rp8 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 8)); // Sub-tropics Warm Semi-humid
var rp9 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 9)); // Sub-tropics Warm Humid
var rp10 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 10)); // Sub-tropics Moderately Cool Semi-arid
var rp11 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 11)); // Sub-tropics Moderately Cool Semi-humid
var rp12 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 12)); // Sub-tropics Moderately Cool Humid
var rp13 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 13)); // Sub-tropics Cool Semi-arid
var rp14 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 14)); // Sub-tropics Cool Semi-humid
var rp15 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 15)); // Sub-tropics Cool Humid
var rp16 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 16)); // Temperate Moderate Dry
var rp17 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 17)); // Temperate Moderate Moist
var rp18 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 18)); // Temperate Moderate Wet
var rp19 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 19)); // Temperate Cool Dry 
var rp20 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 20)); // Temperate Cool Moist 
var rp21 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 21)); // Temperate Cool Wet 
var rp22 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 22)); // Cold No Permafrost Dry
var rp23 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 23)); // Cold No Permafrost Moist
var rp24 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 24)); // Cold No Permafrost Wet
var rp25 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 25)); // Dominantly Very Steep Terrain
var rp26 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 26)); // Severe Soil/Terrain Limitations
var rp27 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 27)); // Ample Irrigated Soils
var rp28 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 28)); // Dominantly Hydromorphic Soils
var rp29 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 29)); // Desert/Arid Climate
var rp30 = generateRandomPoints(cropMosaic, convertAEZtoShapefile(aez, 32)); // Dominantly Built-up

// Merge and export the random points to Drive
var pointList = [rp1,rp2,rp3,rp4,rp5,rp6,rp7,rp8,rp9,rp10,rp11,rp12,rp13,rp14,rp15,
                rp16,rp17,rp18,rp19,rp20,rp21,rp22,rp23,rp24,rp25,rp26,rp27,rp28,rp29,rp30];
var mergedPoints = ee.FeatureCollection(pointList).flatten();

Export.table.toDrive({
  collection: mergedPoints,
  description: 'Random_Points_By_AEZ',
  folder: 'Random_Points',
  fileFormat: 'SHP'
});

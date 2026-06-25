GMIA-NEXT: Next-Generation Global Map of Irrigated Areas Using Data Fusion
=========================================================================

GMIA-NEXT is a high-resolution (30-meter) global map of irrigated areas for the 2023/24 growing season. It integrates multi-source remote sensing, machine learning, and agricultural statistics to generate an improved, next-generation representation of the current extent of irrigated cropland.

This repository contains all accompanying code used to prepare, train, post-process, and validate the GMIA-NEXT dataset.

-------------------------------------------------------------------------------

Repository Overview
-------------------

The repository is organized into two core components:

1. `data/` Directory  
   Contains input datasets used throughout the GMIA-NEXT workflow,  feature layers, ancillary spatial data, and curated ground-truth samples.

2. `code/` Directory  
   Includes Jupyter notebooks and scripts that implement the full GMIA-NEXT pipeline. The workflow is divided into five key stages:

   - Curating Ground-Truth Points (GTPs)  
   - Gathering and Preprocessing Input Datasets  
   - Random Forest Model Development  
   - Post-Processing  
   - Validation  

-------------------------------------------------------------------------------

1. Curating Ground-Truth Points (GTPs)
--------------------------------------

This notebook documents the process of generating and refining ground-truth samples. Using Google Earth Engine (GEE), cropland masks are applied across agro-ecological zones to generate stratified random points. The scripts then convert these points into a curated ground-truth dataset suitable for model training and evaluation.

-------------------------------------------------------------------------------

2. Gathering and Preprocessing Input Datasets
---------------------------------------------

All environmental and spectral predictors are collected and preprocessed using the GEE platform. This includes:

- Seasonal metrics (mean / max / min) of vegetation indices: NDVI, NDWI, GI  
- Hydrological and terrain variables: distance to rivers, elevation (SRTM), slope  
- Climate-driven variables: MODIS ET, PET  
- Aggregation and cloud-masking procedures  

The code exports processed predictor variables on a country-level or sub-national basis for efficient downstream use. Scripts can easily be adapted for large-scale processing.
 
-------------------------------------------------------------------------------

3. Random Forest Model Development
----------------------------------
Two Random Forest (RF) machine learning frameworks were developed to generate the GMIA-NEXT irrigation maps: a continental-scale RF model and a continental Agro-Ecological Zone (AEZ) tile-based RF model.

The **Continental_AEZ_Tile_RF_Model.js** script contains the Google Earth Engine workflow for training individual AEZ tile models and generating irrigation probability and binary maps for each AEZ tile.

The **Continental_Random_Forest_Model.py** script implements a high-performance computing (HPC)-based workflow for training continent-wide Random Forest models and producing country-level irrigation probability and binary prediction maps.

The machine learning workflow includes:

- Feature engineering  
- Training/testing dataset preparation  
- Random Forest model training  
- Cross-validation and performance assessment  
- Exporting probability and binary classification maps  


-------------------------------------------------------------------------------

4. Post-Processing
------------------

Post-processing steps include:

- Converting probability maps to binary irrigation maps  
- Applying a 3×3 majority filter to smooth spatial noise  

These steps produce the final GMIA-NEXT irrigated area layers.

-------------------------------------------------------------------------------

5. Validation
-------------

Validation notebooks compare GMIA-NEXT outputs against multiple independent datasets using spatial agreement metrics, confusion matrices, and regional case studies.

-------------------------------------------------------------------------------

Contributors
------------

- Endalkachew Abebe Kebede  
- Kyle Frankel Davis  
- Gabriel Laboy  
- Kevin Bhimani
- Yanhua Xie
 
-------------------------------------------------------------------------------

Contact
-------

For questions or collaboration inquiries, please contact:  

- Endalkachew Kebede — endiabe@udel.edu  
- Kyle Davis — kfdavis@udel.edu  

-------------------------------------------------------------------------------

Data Citation
-------------

Kebede, E. A., Xie, Y., Laboy, G., Bhimani, K., Boser, A., Urfels, A., Khan, B. M., Adepoju, M., Adeluyi, O., Brauman, K., Casirati, S., Chandrasekaran, S., Deines, J. M., Flach, R., Hansen, M., Hartman, S., Jobbagy, E., Khan, A., Kurapati, V., … Davis, K. F. (2026). GMIA-NEXT: Next-Generation Global Map of Irrigated Areas (Version v0) [Data set]. Zenodo. https://doi.org/10.5281/zenodo.17627111 

-------------------------------------------------------------------------------

Report Citation
---------------

Endalkachew Abebe Kebede, Yanhua Xie, Gabriel Laboy et al. GMIA-NEXT: Next-Generation Global Map of Irrigated Areas, 24 June 2026, PREPRINT (Version 2) available at Research Square [https://doi.org/10.21203/rs.3.rs-10085674/v2]


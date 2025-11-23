GMIA-NEXT: Next-Generation Global Map of Irrigated Areas Using Data Fusion
=========================================================================

GMIA-NEXT is a high-resolution (30-meter) global map of irrigated areas for the 2023/24 growing season. It integrates multi-source remote sensing, machine learning, and agricultural statistics to generate an improved, next-generation representation of contemporary irrigated land.

This repository contains all accompanying code used to prepare, train, post-process, and validate the GMIA-NEXT dataset.

-------------------------------------------------------------------------------

Repository Overview
-------------------

The repository is organized into two core components:

1. `data/` Directory  
   Contains input datasets used throughout the GMIA-NEXT workflow, including satellite imagery, hydrological layers, ancillary spatial data, and curated ground-truth samples.

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

The machine learning workflow includes:

- Feature engineering  
- Training/testing dataset preparation  
- Random Forest model training  
- Cross-validation and performance assessment  
- Exporting probability and binary classification maps  

Although the model was initially executed on a high-performance computing (HPC) system integrated with Google Drive via PyDrive, the workflow is compatible with any Python environment (e.g., Jupyter Notebook, Spyder).

-------------------------------------------------------------------------------

4. Post-Processing
------------------

Post-processing steps include:

- Converting probability maps to binary irrigation maps  
- Calibrating results to (sub)national Area Equipped for Irrigation statistics  
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

-------------------------------------------------------------------------------

Contact
-------

For questions or collaboration inquiries, please contact:  

- Endalkachew Kebede — endiabe@udel.edu  
- Kyle Davis — kfdavis@udel.edu  

-------------------------------------------------------------------------------

Data Citation
-------------

Endalkachew Kebede, Gabriel Laboy, Kevin Bhimani, Anna Boser, Stefano Casirati, Jillian M. Deines, Rafaela Flach, Esteban Jobbagy, Bhoktear Khan, Vasavi Kurapati, Tyler Lark, Jack Marquez, Holly Michael, Kin Hong NG, Paula Olaya, Lorenzo Rosa, Stefan Siebert, Michela Taufer, Kin Wai NG, Anton Urferls, Kyle Frankel Davis.  
GMIA-NEXT: Next-Generation Global Map of Irrigated Areas Using Data Fusion. Zenodo.  

-------------------------------------------------------------------------------

Report Citation
---------------

Endalkachew Kebede, Gabriel Laboy, Kevin Bhimani, Anna Boser, Stefano Casirati, Jillian M. Deines, Rafaela Flach, Esteban Jobbagy, Bhoktear Khan, Vasavi Kurapati, Tyler Lark, Jack Marquez, Holly Michael, Kin Hong NG, Paula Olaya, Lorenzo Rosa, Stefan Siebert, Michela Taufer, Kin Wai NG, Anton Urferls, Kyle Frankel Davis.  
GMIA-NEXT: Next-Generation Global Map of Irrigated Areas Using Data Fusion. EarthArXiv (Preprint).
"""

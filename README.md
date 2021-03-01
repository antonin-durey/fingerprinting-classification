# Fingerprinting classification technique

See <URL> for algorithm and technique details

## Data format

Check the `examples/dataset` for example. Each file in this folder contains the API calls made by a script. 

## Configuration

Edit the config file `config.json` to update the path of your dataset, and the keywords you want to put when labelling manually.

## Execution

Run with `node ultimateClassifier.js`,
You will need to manually label some files.
The file containing the manual label is `runtime/manual.csv`
Each time a script needs to be classified, it will be added in this file.
Fill the c`oracle` column with your keyword to tell the algorithm if you consider if it is a fingerprinting script or not.
You can add other columns to this file, for example to keep track of the reasons that conducted you to give this label.
These reasons could be:
- script is blocked by Anti tracking extension
- script contains obvious keyword revealing its goal
- ...

Once it's done, save and relaunch the execution with `node ultimateClassfier.js`

At the end, check the `results` folder for the output labels and data.
(async () => {
  const fs = require('fs');
  const configData = await fs.readFileSync('./config.json')
  const config = JSON.parse(configData);

  const core = require('./core');
  const createCsvWriter = require('csv-writer').createObjectCsvWriter;

  const manualClassificationFilename = 'manual.csv'
  const manualClassificationFilepath = `${config.folders.runtime}/${manualClassificationFilename}`;

  const groundTruthElements = await core.getAllFolderElements(config.folders.groundTruth);
  const datasetElements = await core.getAllFolderElements(config.folders.dataset);

  const groundTruthScriptsElements = core.getScriptsElements(groundTruthElements);
  const datasetScriptsElements = core.getScriptsElements(datasetElements);


  const evolvingScores = [];
  const evolvingNbs = [];
  let cpt = 0;
  const unknown = [];


//  let attributesParameters = core.getAttributeParameterListFromData(groundTruthScriptsElements);
//  attributesParameters = attributesParameters.concat(core.getAttributeParameterListFromData(datasetScriptsElements));

  let hasEnded = false;

  let fpManuallyLabelled = 0;
  let nonFpManuallyLabelled = 0;

  if(!fs.existsSync(config.folders.runtime)) {
    fs.mkdirSync(config.folders.runtime);
  }

  const nonFingerprinters = {};
  const fingerprinters = [];
  const manualClassificationResults = await core.getManualClassificationResults(manualClassificationFilepath);

  console.log(`Beginning of the classification algorithm`)
  console.log(`Input dataset size: ${Object.keys(datasetScriptsElements).length}`);
  while(!hasEnded) {
    console.log(`----------------------------`);
    let needToRecomputeAttributes = false;
    cpt++;
    const results = core.getIntersectionsForAllDatasetScripts(groundTruthScriptsElements, datasetScriptsElements);
    evolvingScores.push(core.getGroupedScores(results));
    const decroissantOrdersKeys = core.getDecroissantOrderKeys(results);
    let i = 0;
    while(!needToRecomputeAttributes && i < decroissantOrdersKeys.length) {
      const script = decroissantOrdersKeys[i];
      if(results[script].score === 1 && !fingerprinters.includes((script))) {
        console.log(`Script ${script} has a similarity score of ${Math.round(results[script].score*100)/100} with the closest fingerprinter.`);
        console.log(`\tIt's a fingerprinter. Updating data and analyzing next script...`);
        fingerprinters.push(script);
        if(Object.keys(nonFingerprinters).includes(script)) {
          delete nonFingerprinters[script];
        }

        if(unknown.includes(script)) {
          unknown.splice(unknown.indexOf(script));
        }
      } else {
        if(!fingerprinters.includes(script) && !Object.keys(nonFingerprinters).includes(script) && !unknown.includes(script) && script !== ''){
          console.log(`Script ${script} has a similarity score of ${Math.round(results[script].score*100)/100} with the closest fingerprinter.`);
          console.log(`\tCompute intersection with non fingerprinters`);
          // Compute similarity with non-fingerprinters
          const result = core.getHighestIntersectionAndJaccardBetweenDatasetScriptAndScriptsList(nonFingerprinters, results[script].intersection);
          if(Object.keys(result.intersection).length === Object.keys(results[script].intersection).length) {
            console.log(`\tIntersections matches. Script is non fingerprinter`);
            // If the intersection between the script and a non fingerprinter is similar to the previous intersection computed, the script being analyzed in not a fingerprinter.
            nonFingerprinters[script] = datasetScriptsElements[script];
          } else {
            console.log(`\tThe script needs to be manually classified`);
            // The file needs to be manually classified
            // We check if it has already been done
            if (manualClassificationResults[script] === undefined) {
              // If no, we ask for manual classification
//              await core.saveJSON(`${config.folders.runtime}/groundTruth.json`, groundTruthScriptsElements);
              await core.saveJSON(`${config.folders.runtime}/fingerprinters.json`, fingerprinters);
              await core.saveJSON(`${config.folders.runtime}/nonFingerprinters.json`, nonFingerprinters);
              await core.saveJSON(`${config.folders.runtime}/unknown.json`, unknown);

              core.addScriptToManualClassificationFile(manualClassificationFilepath, script);

              console.log(`\n\tA script cannot be classified automatically. Please perform a manual analysis of the script '${script}' and complete column 'oracle' of the file ${manualClassificationFilepath}.`);
              return;
            } else {
              console.log(`\tThe script has been manually classified as ${manualClassificationResults[script]}`);
              if (manualClassificationResults[script] === config.manualKeys.nonFingerprinter) {
                nonFpManuallyLabelled++;
                nonFingerprinters[script] = datasetScriptsElements[script];
                needToRecomputeAttributes = true;
              } else if (manualClassificationResults[script] === config.manualKeys.fingerprinter) {
                groundTruthScriptsElements[script] = datasetScriptsElements[script];
                needToRecomputeAttributes = true;
                fpManuallyLabelled++;
              } else {
                unknown.push(script);
              }
            }
          }
        }
      }
      i++;
    }
    if(needToRecomputeAttributes) {
      console.log(`\nNeed to update recompute the API calls and the similarity scores....`)
    }
    if(i >= decroissantOrdersKeys.length) {
      hasEnded = true;
    }
    evolvingNbs.push({
      fingerprinters: fingerprinters.length,
      nonFingerprinters: Object.keys(nonFingerprinters).length,
      unknown: unknown.length,
      remaining: Object.keys(datasetScriptsElements) - 1 - fingerprinters.length - Object.keys(nonFingerprinters).length - unknown.length,
    });
  }

  // Classification has ended. Print stats and save files
  console.log(`----------------------------`);
  console.log(`Classification has ended. Check the files in the ${config.folders.results}. Stats are below.\n`)

  console.log(`Size of the input dataset: ${Object.keys(datasetScriptsElements).length}`)
  console.log(`\tNumber of fingerprinters in the input dataset : ${fingerprinters.length}`);
  console.log(`\tNumber of non fingerprinters in the input dataset : ${Object.keys(nonFingerprinters).length}`);
  console.log(`\nNumber of scripts manually labelled : ${(nonFpManuallyLabelled + fpManuallyLabelled + unknown.length)}`);
  console.log(`\t Fingerprinters: ${fpManuallyLabelled}`);
  console.log(`\t Non Fingerprinters : ${nonFpManuallyLabelled}`);
  console.log(`\t Unknown: ${unknown.length}`);

  if(!fs.existsSync(config.folders.results)) {
    fs.mkdirSync(config.folders.results);
  }
  await core.saveJSON(`${config.folders.results}/groundTruth.json`, groundTruthScriptsElements);
  await core.saveJSON(`${config.folders.results}/fingerprinters.json`, fingerprinters);
  await core.saveJSON(`${config.folders.results}/nonFingerprinters.json`, Object.keys(nonFingerprinters));
  await core.saveJSON(`${config.folders.results}/unknown.json`, unknown);


  const headers = Object.keys(evolvingScores[0]);
  const csvWriter = createCsvWriter({
    path: `${config.folders.results}/evolvingScores.csv`,
    header: headers
  });

  // await csvWriter.writeRecords(evolvingScores);


  const headersBis = Object.keys(evolvingNbs[0]);
  const csvWriterBis = createCsvWriter({
    path: `${config.folders.results}/evolvingNbs.csv`,
    header: headersBis
  });

  // await csvWriterBis.writeRecords(evolvingNbs);

})().catch(e => {
  console.log(e)
});
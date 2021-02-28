(async () => {
  const core = require('./core');
  const createCsvWriter = require('csv-writer').createObjectCsvWriter;

  const groundTruthFolder = 'groundTruth';
  const wildDatasetFolder = 'wildDataset';

  const resultsFilepath = 'results.json'
  const manualClassificationFile = 'classification/manual.json'

  const groundTruthElements = await core.getAllFingerprintersElements(groundTruthFolder);
  const datasetElements = await core.getWildDatasetElements();

  const groundTruthScriptsElements = core.getScriptsElements(groundTruthElements);
  const datasetScriptsElements = core.getScriptsElements(datasetElements);

  const nonFingerprinters = {};
  const fingerprinters = [];
  const manualClassificationResults = await core.getManualClassificationResults(manualClassificationFile);

  const evolvingScores = [];
  const evolvingNbs = [];
  let cpt = 0;
  const unknown = [];


  let attributesParameters = core.getAttributeParameterListFromData(groundTruthScriptsElements);
  attributesParameters = attributesParameters.concat(core.getAttributeParameterListFromData(datasetScriptsElements));

  let hasEnded = false;

  let fpManuallyLabelled = 0;
  let nonFpManuallyLabelled = 0;

  console.log(groundTruthElements);

  while(!hasEnded) {
    let needToRecomputeAttributes = false;
    cpt++;
    console.log('--------------------------');
    console.log('Iteration n°' + cpt);

    const results = core.getIntersectionsForAllDatasetScripts(groundTruthScriptsElements, datasetScriptsElements);
    evolvingScores.push(core.getGroupedScores(results));
    const decroissantOrdersKeys = core.getDecroissantOrderKeys(results);
    let i = 0;
    while(!needToRecomputeAttributes && i < decroissantOrdersKeys.length) {
      const script = decroissantOrdersKeys[i];

      if(results[script].score === 1 && !fingerprinters.includes((script))) {
        console.log(i + ' : ' + results[script].score + ' : ' + script);
        fingerprinters.push(script);
        if(Object.keys(nonFingerprinters).includes(script)) {
          delete nonFingerprinters[script];
        }

        if(unknown.includes(script)) {
          unknown.splice(unknown.indexOf(script));
        }
      } else {
        if(!fingerprinters.includes(script) && !Object.keys(nonFingerprinters).includes(script) && !unknown.includes(script) && script !== ''){
          console.log(i + ' : ' + results[script].score + ' : ' + script);
          // Compute similarity with non-fingerprinters
          const result = core.getHighestIntersectionAndJaccardBetweenDatasetScriptAndScriptsList(nonFingerprinters, results[script].intersection);
          if(Object.keys(result.intersection).length === Object.keys(results[script].intersection).length) {
            // If the intersection between the script and a non fingerprinter is similar to the previous intersection computed, the script being analyzed in not a fingerprinter.
            nonFingerprinters[script] = datasetScriptsElements[script];
          } else {
            // The file needs to be manually classified
            // We check if it has already been done
            if (manualClassificationResults[script] === undefined) {
              // If no, we ask for manual classification
              await core.saveJSON(groundTruthTmpFilepath, groundTruthScriptsElements);
              await core.saveJSON(fingerprintersTmpFilepath, fingerprinters);
              await core.saveJSON(nonFingerprintersTmpFilepath, nonFingerprinters);
              await core.saveJSON(unknownTmpFilepath, unknown);
              console.log(`The following script cannot be classified automatically. Please edit the file ${manualClassificationFile} to classify the script $script.`);
              return;
            } else if (manualClassificationResults[script] === 'no') {
              nonFpManuallyLabelled++;
              nonFingerprinters[script] = datasetScriptsElements[script];
              needToRecomputeAttributes = true;
            } else if (manualClassificationResults[script] === 'yes') {
              groundTruthScriptsElements[script] = datasetScriptsElements[script];
              needToRecomputeAttributes = true;
              fpManuallyLabelled++;
            } else {
              unknown.push(script);
            }
          }
        }
      }
      i++;
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

  console.log('Fingerprinters.length : ' + fingerprinters.length);
  console.log('Non-Fingerprinters.length : ' + Object.keys(nonFingerprinters).length);
  console.log('nb scripts manually labelled : ' + (nonFpManuallyLabelled + fpManuallyLabelled));
  console.log('nb fp manually labelled : ' + fpManuallyLabelled);
  console.log('nb non fp manually labelled : ' + nonFpManuallyLabelled);
  console.log('nb unknown manually labelled : ' + unknown.length);


  await core.saveJSON(groundTruthTmpFilepath, groundTruthScriptsElements);
  await core.saveJSON(fingerprintersTmpFilepath, fingerprinters);
  await core.saveJSON(nonFingerprintersTmpFilepath, nonFingerprinters);
  await core.saveJSON(unknownTmpFilepath, unknown);


  const headers = Object.keys(evolvingScores[0]);
  const csvWriter = createCsvWriter({
    path: 'iterations/final/evolvingScores.csv',
    header: headers
  });

  csvWriter.writeRecords(evolvingScores).then(() => {
  });


  const headersBis = Object.keys(evolvingNbs[0]);
  const csvWriterBis = createCsvWriter({
    path: 'iterations/final/evolvingNbs.csv',
    header: headersBis
  });

  csvWriterBis.writeRecords(evolvingNbs).then(() => {
  });

  console.log('The end');
})().catch(e => {
  console.log(e)
});
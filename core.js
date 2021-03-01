const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const csv = require('csv-parser');
const fs = require('fs');

const getParametersString = function(parameter) {
  if(parameter === undefined || parameter === null) {
    return '';
  }
  if(typeof parameter === 'string') {
    return parameter;
  }

  if(typeof parameter === 'object') {
    let s = '{';
    Object.keys(parameter).forEach(function(key) {
      s += getParametersString(parameter[key]) + ',';
    });
    s = s.substring(0, s.length - 1) + '}';
    return s;
  }
};

const getScriptsElements = function(allElements) {
  const scriptsElement = {};

  allElements.forEach(function(element) {
    if(!Object.keys(scriptsElement).includes(element.origin)) {
      scriptsElement[element.origin] = {};
    }
    const thisToStringArguments = mergeThisToStringProperty(element.thisToString, element.property) + '|' + getParametersString(element.arguments);
    if(!Object.keys(scriptsElement[element.origin]).includes(thisToStringArguments)) {
      scriptsElement[element.origin][thisToStringArguments] = element.nbTimes;
    }

  });
  return scriptsElement;
};

const mergeThisToStringProperty = function (thisToString, property) {
  let str = property;
  if (property !== undefined && thisToString !== undefined && !property.includes(thisToString) && !thisToString.includes(property)) {
    str = thisToString + property;
  }

  return str;
};

const getAllFolderElements = async function(folder) {
  let allElements = [];
  const files = fs.readdirSync(folder);
  for(let i = 0;i<files.length;i++) {
    const file = files[i];
    const filepath = folder + '/' + file;
    const content = await fs.readFileSync(filepath).toString();
    const fileElements = JSON.parse(content);

    fileElements.forEach(function(element) {
      element.origin = file.replace('.json', '');
    });

    allElements = allElements.concat(fileElements);
  }

  return allElements;
};


const getIntersectionAndJaccardBetweenTwoScripts = function(firstScriptElement, secondScriptElement) {
  function removeDups(names) {
    let unique = {};
    names.forEach(function(i) {
      if(!unique[i]) {
        unique[i] = true;
      }
    });
    return Object.keys(unique);
  }

  const attributesParameters = removeDups(Object.keys(firstScriptElement).concat(Object.keys(secondScriptElement)));

  const intersection = {};
  let union = 0;
  let intersec = 0;
  attributesParameters.forEach(function(attributeParameter) {
    if(firstScriptElement[attributeParameter] !== undefined || secondScriptElement[attributeParameter] !== undefined) {
      union++;
      if (firstScriptElement[attributeParameter] === secondScriptElement[attributeParameter]) {
        intersec++;
        intersection[attributeParameter] = firstScriptElement[attributeParameter];
      }
    }
  });

  return {
    score: intersec / union,
    intersection: intersection,
  };
};

const getHighestIntersectionAndJaccardBetweenDatasetScriptAndScriptsList = function(fingerprintersElements, datasetScriptElement) {
  let biggestResult = {
    score: 0,
    intersection: []
  };
  const fingerprinters = Object.keys(fingerprintersElements);
  fingerprinters.forEach(function(fingerprinter){
    const result = getIntersectionAndJaccardBetweenTwoScripts(fingerprintersElements[fingerprinter], datasetScriptElement);
    if(result.score > biggestResult.score) {
      biggestResult = result;
    }
  });
  return biggestResult;
};

const getIntersectionsForAllDatasetScripts = function(fingerprintersElements, datasetScriptsElements) {
  const scriptsResults = {};
  const scripts = Object.keys(datasetScriptsElements);
  let i = 0;
  scripts.forEach(function(script){
    scriptsResults[script] = getHighestIntersectionAndJaccardBetweenDatasetScriptAndScriptsList(fingerprintersElements, datasetScriptsElements[script]);
  });
  return scriptsResults;
};


const getAttributeParameterListFromData = function(dataScriptsElements) {
  const finalAttributesParameters = [];
  const fingerprintersScripts = Object.keys(dataScriptsElements);
  fingerprintersScripts.forEach(function(fingerprinterScript) {
    const attributesParameters = Object.keys(dataScriptsElements[fingerprinterScript]);
    attributesParameters.forEach(function(attributeParameter) {
      if(!finalAttributesParameters.includes(attributeParameter)) {
        finalAttributesParameters.push(attributeParameter);
      }
    });
  });
  return finalAttributesParameters;
};

const getDecroissantOrderKeys = function(map) {
  const decroissantOrderKeys = [];
  let keys = Object.keys(map);
  while(keys.length !== 0) {
    let correspondingKey;
    let highestValue;
    for(let i=0;i<keys.length;i++) {
      const key = keys[i];
      if(highestValue === undefined || highestValue < map[key].score) {
        highestValue = map[key].score;
        correspondingKey = key;
      }
    }
    keys.splice(keys.indexOf(correspondingKey), 1);
    decroissantOrderKeys.push(correspondingKey);
  }
  return decroissantOrderKeys;


};

const getManualClassificationResults = function(filepath) {
  return new Promise(async function (resolve, reject) {
    const manualClassificationResults = {};
    if (fs.existsSync(filepath)) {
      fs.createReadStream(filepath)
          .pipe(csv())
          .on('data', async (row) => {
            manualClassificationResults[row.script] = row.oracle;
          }).on('end', () => {
            resolve(manualClassificationResults);
          }
      );
    } else {
      // File not found
      resolve(manualClassificationResults);
    }
  });
};

const addScriptToManualClassificationFile = async function(filepath, script) {
  return new Promise(function(resolve, reject) {
    if(!fs.existsSync(filepath)) {
      fs.copyFileSync('manual-template.csv', filepath);
    }

    const manualClassificationData = [];
    fs.createReadStream(filepath)
        .pipe(csv())
        .on('data', async (row) => {
          manualClassificationData.push(row);
        }).on('end', () => {
          manualClassificationData.push({script: script, oracle: ""});
          const headers = [];
          Object.keys(manualClassificationData[0]).forEach(function(header) {
            headers.push({title: header, id: header});
          });
          const csvWriter = createCsvWriter({
            path: filepath,
            header: headers
          });

          csvWriter.writeRecords(manualClassificationData).then(() => {
            resolve();
          });

        }
    );
  });
}

const getGroupedScores = function(results) {
  const precision = 0.01;
  const scores = {};
  for(let i = 1;i >= 0;i -= precision) {
    scores[i.toFixed(2)] = 0;
  }
  scores['0.00'] = 0;


  const scripts = Object.keys(results);

  scripts.forEach(function(script){
//    console.log(results[script].score);
    scores[results[script].score.toFixed(2)] += 1;
  });
  return scores;
};

const saveJSON = async function(filepath, filecontent) {
  await fs.writeFileSync(filepath, JSON.stringify(filecontent))
};

const loadJSON = async function(filepath) {
  const content = await fs.readFileSync(filepath);
  return JSON.parse(content.toString());
};

module.exports = {
  getAllFolderElements: getAllFolderElements,
  getScriptsElements: getScriptsElements,
  getAttributeParameterListFromData: getAttributeParameterListFromData,
  getDecroissantOrderKeys: getDecroissantOrderKeys,
  getManualClassificationResults: getManualClassificationResults,
  addScriptToManualClassificationFile: addScriptToManualClassificationFile,
  getIntersectionsForAllDatasetScripts: getIntersectionsForAllDatasetScripts,
  getHighestIntersectionAndJaccardBetweenDatasetScriptAndScriptsList: getHighestIntersectionAndJaccardBetweenDatasetScriptAndScriptsList,
  getIntersectionAndJaccardBetweenTwoScripts: getIntersectionAndJaccardBetweenTwoScripts,
  getGroupedScores: getGroupedScores,
  saveJSON: saveJSON,
  loadJSON: loadJSON
};
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const csv = require('csv-parser');
const fs = require('fs');
const request = require('request');

let url = "mongodb://localhost:27018/";

const folder = 'sure';

const NO_FINGERPRINTING = 'NO FINGERPRINTING';


const getWildData = function(){
  return [];
}

const writeIntoFile = function (filepath, content) {
  fs.writeFile(filepath, content, function (err) {
    if (err) {
      return console.log(err);
    }
    console.log("The file was saved!");
  });
}

const getFirstSecondDomain = function (domain) {
  const domainRegex = /[^.]*\.[^.]{2,3}(?:\.[^.]{2,3})?$/g;
  let res = domainRegex.exec(domain);
  if (res !== null && res !== undefined) {
    return res[0];
  }
  return domain;
};

// console.log(realFinalWebpageList.length);

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

const oneOfNonFingerprintersHasAScoreOfOne = function(nonFingerprinters, datasetScriptsElements, fingerprintersScriptsElements) {
  nonFingerprinters.forEach(function(nonFingerprinter){
    const nonFingerprinterElements = datasetScriptsElements[nonFingerprinter];
    const result = getIntersectionAndJaccardBetweenTwoScripts(fingerprintersScriptsElements, nonFingerprinterElements);
    if(result.score === 1) {
      return true;
    }
  });

  return false;
};

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

const getFingerprintersList = function() {
  return new Promise(function(resolve, reject) {
    const fingerprinters = {};
    fs.createReadStream('iterations/fingerprinters_grouped.csv')
      .pipe(csv())
      .on('data', (row) => {
        fingerprinters[row.fingerprinter] = row.merge;
      }).on('end', () => {
      resolve(fingerprinters);
    });
  });
};

const getFinalFingerprinters = function() {
  return new Promise(function(resolve, reject) {
    const fingerprinters = [];
    fs.createReadStream('iterations/fingerprinters.csv')
      .pipe(csv())
      .on('data', (row) => {
        fingerprinters.push(row.fingerprinter);
      }).on('end', () => {
      resolve(fingerprinters);
    });
  })
};

const getFpInstances = function(fingerprinters, allElements) {
  console.log(allElements.length);

  const instances = {};
  allElements.forEach(function(element) {
    if(fingerprinters.includes(element.origin)) {
      if(instances[element.origin] === undefined) {
        instances[element.origin] = [];
      }
      if(!instances[element.origin].includes(element.webpage)){
        instances[element.origin].push(element.webpage)
      }
    }
  });

  return instances;
};



const getFingerprintersAttribute = function(fingerprinters, datasetScripts) {
  return new Promise(function(resolve, reject) {
    const attributesNbTimes = {};

    fingerprinters.forEach(function(fingerprinter) {
      const scriptAttr = [];
      console.log(fingerprinter);
      Object.keys(datasetScripts[fingerprinter]).forEach(function(attribute) {
        let tmpAttribute = attribute.substring(0, attribute.indexOf("|"));
        if(!scriptAttr.includes(tmpAttribute)) {
          scriptAttr.push(tmpAttribute);
          if(!Object.keys(attributesNbTimes).includes(tmpAttribute)) {
            attributesNbTimes[tmpAttribute] = 1;
          } else {
            attributesNbTimes[tmpAttribute] += 1;
          }
        }
      })
    });

    const headers = [
      {id: 'attribute', title: 'attribute'},
      {id: 'nb', title: 'nb'}
    ];

    const csvElements = [];
    const attributes = Object.keys(attributesNbTimes).sort();
    attributes.forEach(function(attribute) {
      csvElements.push({
        attribute: attribute.substring(0, 100),
        nb: attributesNbTimes[attribute],
      })
    });

    const csvWriter = createCsvWriter({
      path: 'iterations/final/fingerprintersAttributesDistribution_bis.csv',
      header: headers
    });

    csvWriter.writeRecords(csvElements).then(() => {
      resolve();
    });
  })
};

const loadFingerprintersAttributes = function() {
  return new Promise(function(resolve, reject) {
    const fingerprintersAttributes = [];
    fs.createReadStream('./iterations/fingerprintersAttributesDistribution.csv')
      .pipe(csv())
      .on('data', async (row) => {
        fingerprintersAttributes.push(row);
      }).on('end', () => {
      resolve(fingerprintersAttributes);
    });
  });
};

const getAttributeFamily = async function() {

  const fingerprintersAttributes = await loadFingerprintersAttributes();

  const attributeFamily = {};
  fingerprintersAttributes.forEach(function(fingerprinterAttribute) {
    attributeFamily[fingerprinterAttribute.attribute] = fingerprinterAttribute.type;
  });

  return attributeFamily;
};

const getNbNonFingerprintersUsingAttribute = function(datasetScriptsElements, fingerprinters, attribute) {
  const allScripts = Object.keys(datasetScriptsElements);
  let nb = 0;
  allScripts.forEach(function(script) {
    if(!fingerprinters.includes(script) && datasetScriptsElements[script][attribute] !== undefined && datasetScriptsElements[script][attribute] !== 0) {
      nb++;
    }
  });
  return nb;

};

const getScriptsHavingAttributeOfFamily = function(allElements, fingerprinters, attributeFamily, family) {
  const scripts = [];
  allElements.forEach(function(element) {
    const thisToStringArguments = mergeThisToStringProperty(element.thisToString, element.property) + '|' + getParametersString(element.arguments);

    if(fingerprinters.includes(element.origin) && attributeFamily[thisToStringArguments] === family && !scripts.includes(element.origin)) {
      scripts.push(element.origin);
    }
  });

  return scripts;
};

const getElementsOfAttributeFamilyInScript = function(datasetScriptsElement, script, attributeFamily, family) {
  let res = {};
  Object.keys(datasetScriptsElement[script]).forEach(function(attribute) {
    if(attributeFamily[attribute] === family) {
      res[attribute] = datasetScriptsElement[script][attribute];
    }
  });
  return res;
};

const getIdenticalAttributeOfFamily = function(datasetScriptsElements, scripts, attributeFamily, family) {
  const res = {};

  scripts.forEach(function(script) {
    let toBeAdded = true;
    let identical = true;
    const attributes = getElementsOfAttributeFamilyInScript(datasetScriptsElements, script, attributeFamily, family);
    if(Object.keys(res).length > 0) {
      Object.keys(res).forEach(function (s) {
        identical = true;
        if (Object.keys(res[s].attributes).length !== Object.keys(attributes).length) {
          identical = false;
        }

        const allAttributes = Object.keys(attributes);
        let i = 0;
        while(i<allAttributes.length && identical) {
          const attribute = allAttributes[i];
          if (datasetScriptsElements[s][attribute] !== attributes[attribute]) {
            identical = false;
          }
          i++;
        }
        if (identical) {
          toBeAdded = false;
          res[s].nb++;
        }
      });
    }
    if(toBeAdded || Object.keys(res).length === 0) {
      res[script] = {
        attributes: attributes,
        nb: 1,
      };
    }
  });
  return res;
};

const compureDistanceBetweenAllFingerprinters = function(datasetScriptsElements, fingerprinters) {

  const results = [];
  fingerprinters.forEach(function(fpScript) {
    const result = {};
    fingerprinters.forEach(function(fpScriptBis) {
      if(fpScript !== fpScriptBis)
        result[fpScriptBis] = getIntersectionAndJaccardBetweenTwoScripts(datasetScriptsElements[fpScriptBis], datasetScriptsElements[fpScript]).score;
    });
    results[fpScript] = result;
  });

  const formattedResults = [];

  const headers = [{
    title: 'fingerprinter',
    id: 'fingerprinter'
  }];

  fingerprinters.forEach(function(fpScript) {
    headers.push({title: fpScript, id: fpScript});
    const result = results[fpScript];
    result['fingerprinter'] = fpScript;
    formattedResults.push(result);
  });

  const csvWriter = createCsvWriter({
    path: 'iterations/final/fingeprintersDistance.csv',
    header: headers
  });

  csvWriter.writeRecords(formattedResults).then(() => {
    console.log("Writing done");
  });
};

const getKeywords = function () {
  return new Promise(function (resolve, reject) {
    const scripts = {};

    fs.createReadStream('iterations/final/detectKeywords.csv')
      .pipe(csv())
      .on('data', (row) => {
        scripts[row.url] = {};
        scripts[row.url]['fingerprintjs'] = row.fingerprintjs;
        scripts[row.url]['fingerprint2'] = row.fingerprint2;
        scripts[row.url]['hasLiedBrowser'] = row.hasLiedBrowser;
        scripts[row.url]['hasLiedLanguages'] = row.hasLiedLanguages;
        scripts[row.url]['hasLiedResolution'] = row.hasLiedResolution;
        scripts[row.url]['hasLiedOs'] = row.hasLiedOs;
      }).on('end', () => {
      resolve(scripts);
    });
  });
};

const getScriptsFromFingerprintJS = async function(datasetScriptsElements, fingerprinters, fingerprintJS2, attributeFamily, families) {
  const finalResults = {};
  const tmpFingerprinters = [];
  finalResults['score equals 1'] = [];
  fingerprinters.forEach(function(fpScript) {
    const score = getIntersectionAndJaccardBetweenTwoScripts(datasetScriptsElements[fpScript], datasetScriptsElements[fingerprintJS2]).score;
    if(score === 1) {
      finalResults['score equals 1'].push(fpScript);
    } else {
      tmpFingerprinters.push(fpScript);
    }
  });

  for(let i = 0;i<tmpFingerprinters.length;i++) {
    const fingerprinter = tmpFingerprinters[i];
    families.forEach(function(family) {
      const attributesFPJS2 = getElementsOfAttributeFamilyInScript(datasetScriptsElements, fingerprintJS2, attributeFamily, family);
      const attributesFP = getElementsOfAttributeFamilyInScript(datasetScriptsElements, fingerprinter, attributeFamily, family);
      const result = getIntersectionAndJaccardBetweenTwoScripts(attributesFP, attributesFPJS2);
      if(result.score === 1){
        if(finalResults[family] === undefined) {
          finalResults[family] = [];
        }
        if(!finalResults[family].includes(fingerprinter)) {
          finalResults[family].push(fingerprinter);
        }
      }
    });

    const scriptsKeywords = await getKeywords();
    const keywords = ['fingerprintjs', 'fingerprint2', 'hasLiedBrowser', 'hasLiedLanguages', 'hasLiedResolution', 'hasLiedOs'];
    keywords.forEach(function(keyword) {
      if(scriptsKeywords[fingerprinter][keyword] === 'true') {
        if(finalResults[keyword] === undefined) {
          finalResults[keyword] = [];
        }
        if(!finalResults[keyword].includes(fingerprinter)) {
          finalResults[keyword].push(fingerprinter);
        }
      }
    });
  }


  return finalResults;
};

const getDomain = function (domain) {
  const domainRegex = /^(?:https?:\/\/)?(?:[^@\/\n]+@)?(?:www\.)?([^:\/?\n]+)/g;
  let res = domainRegex.exec(domain);
  if (res !== null && res !== undefined) {
    return res[0];
  }
  return domain;
};

const getDomainsTags = function(filename) {
  return new Promise(async function (resolve, reject) {
    const domainTags = [];
    fs.createReadStream(filename)
      .pipe(csv())
      .on('data', async (row) => {
        if(row.firstSecondDomain !== undefined) {
          domainTags[row.firstSecondDomain] = {};
          domainTags[row.firstSecondDomain].country = row.domainCountryTag;
          domainTags[row.firstSecondDomain].type = row.domainTypeTag;
        }
      }).on('end', () => {
      resolve(domainTags);
    });
  });
};

const getWebpageTags = function(filename) {
  return new Promise(async function (resolve, reject) {
    const webpageTypes = ['account-creation',	'authentication',	'password-forgotten',	'payment', 'basket-related', 'account-settings', 'home', 'content-related'];
    const webpageTags = {};
    fs.createReadStream(filename)
      .pipe(csv())
      .on('data', async (row) => {
//          console.log(row);
        if(row.page !== undefined) {
          webpageTags[row.page] = {};
          webpageTypes.forEach(function (webpageType) {
            webpageTags[row.page][webpageType] = row[webpageType] === 'true';
          });
          webpageTags[row.page]['MFA1'] = row.MFA1;
          webpageTags[row.page]['MFA2'] = row.MFA2;
          webpageTags[row.page]['Bot1'] = row.Bot1;
          webpageTags[row.page]['Bot2'] = row.Bot2;
        }

      }).on('end', () => {
      resolve(webpageTags);
    });
  });
};

const getDomainsWitFPOnSignInPages = async function(datasetElements, fingerprinters) {
  const domainPageFingerprinter = [];

  // Get tags
  const webpageTags = await getWebpageTags('./datasetWebpageTags_bis.csv');

  datasetElements.forEach(function(element) {
    if(fingerprinters.includes(element.origin) && webpageTags[element.webpage] !== undefined && webpageTags[element.webpage]['authentication']) {
      const firstSecondDomainName = getFirstSecondDomain(getDomain(element.webpage));
      if(!domainPageFingerprinter.includes(firstSecondDomainName)) {
        domainPageFingerprinter.push(firstSecondDomainName);
      }
    }
  });
  return domainPageFingerprinter;
};

const getDomainsHavingABasketPageWithAFingerprinter = async function(allElements, fingerprinters) {
  const webpageTags = await getWebpageTags('./datasetWebpageTags_bis.csv');
  const domainPageFingerprinter = {};
  console.log('allElements.length');
  console.log(allElements.length);
  allElements.forEach(function(element) {
    if(fingerprinters.includes(element.origin) && webpageTags[element.webpage] !== undefined && webpageTags[element.webpage]['basket-related']) {
      const firstSecondDomainName = getFirstSecondDomain(getDomain(element.webpage));
      if(domainPageFingerprinter[firstSecondDomainName] === undefined) {
        domainPageFingerprinter[firstSecondDomainName] = [];
      }
      if(!domainPageFingerprinter[firstSecondDomainName].includes(element.webpage)) {
        domainPageFingerprinter[firstSecondDomainName].push(element.webpage);
      }
    }
  });

  return domainPageFingerprinter;
};


const getDomainsHavingAllTheirBasketPagesWithoutAFingerprinter = async function(allElements, fingerprinters) {
  const webpageTags = await getWebpageTags('./datasetWebpageTags_bis.csv');
  const domainPageNonFingerprinter = {};
  console.log('allElements.length');
  console.log(allElements.length);
  allElements.forEach(function(element) {
    if(webpageTags[element.webpage] !== undefined && webpageTags[element.webpage]['basket-related']) {
      const firstSecondDomainName = getFirstSecondDomain(getDomain(element.webpage));
      if(domainPageNonFingerprinter[firstSecondDomainName] === undefined) {
        domainPageNonFingerprinter[firstSecondDomainName] = {};
      }

      if(!domainPageNonFingerprinter[firstSecondDomainName][element.webpage] === undefined) {
        domainPageNonFingerprinter[firstSecondDomainName][element.webpage] = true;
      }

      if(fingerprinters.includes(element.origin)) {
        domainPageNonFingerprinter[firstSecondDomainName][element.webpage] = false;
      }
    }
  });

  const finalDomainPageNonFingerprinter = [];
  for(let domain in domainPageNonFingerprinter) {
    let includes = true;
    for(let page in domainPageNonFingerprinter[domain]) {
      if(!domainPageNonFingerprinter[domain][page]) {
        includes = false;
      }
    }

    if(includes) {
      finalDomainPageNonFingerprinter.push(domain);
    }
  }


  return finalDomainPageNonFingerprinter;
};

const fingerprinterDomainType = async function() {
  return new Promise(function(resolve, reject) {
    const fingerprinters = {};
    fs.createReadStream('iterations/final/fingerprinters_grouped.csv')
      .pipe(csv())
      .on('data', (row) => {
        fingerprinters[row.fingerprinter] = row.domainType;
      }).on('end', () => {
      resolve(fingerprinters);
    });
  });
};

const detectScriptsWithSameDomains = function(scripts) {
  const domainsNbScripts = {};
  scripts.forEach(function(script) {
    const domain = getFirstSecondDomain(getDomain(script));
    if(domainsNbScripts[domain] === undefined) {
      domainsNbScripts[domain] = 1;
    } else {
      domainsNbScripts[domain]++;
    }
  });

  let nbs = {};
  Object.keys(domainsNbScripts).forEach(function(domain) {
    if(domainsNbScripts[domain] > 1) {
      console.log(domain + ' : ' + domainsNbScripts[domain]);
      if(nbs[domainsNbScripts[domain]] === undefined) {
        nbs[domainsNbScripts[domain]] = 1;
      } else {
        nbs[domainsNbScripts[domain]]++;
      }
    }
  })

  return nbs;
};

const getFirstThirdPartyFingerprinters = async function(datasetElements, fingerprinters) {
  const domainType = await fingerprinterDomainType(fingerprinters);

  const firstParty = [];
  const thirdParty = [];
  const firstThirdParty = [];
  const firstPartyCategory = {};
  const thirdPartyCategory = {};

  datasetElements.forEach(function(element) {
    if(fingerprinters.includes(element.origin)) {
      const domainScript = getFirstSecondDomain(getDomain(element.origin));
      const domainPage = getFirstSecondDomain(getDomain(element.webpage));

      const category = domainType[element.origin];

      if(domainScript === domainPage) {
        if(!firstParty.includes(element.origin)) {
          firstParty.push(element.origin);

          if(firstPartyCategory[category] === undefined) {
            firstPartyCategory[category] = 0;
          }
          firstPartyCategory[category]++;
        }
      } else {
        if(!thirdParty.includes(element.origin)) {
          thirdParty.push(element.origin);
          if(thirdPartyCategory[category] === undefined) {
            thirdPartyCategory[category] = 0;
          }
          thirdPartyCategory[category]++;
        }
      }
    }
  });


  return {
    firstParty: firstParty,
    thirdParty: thirdParty,
    firstPartyCategory: firstPartyCategory,
    thirdPartyCategory: thirdPartyCategory,
    nbDomainsWithMoreThanOneScript: detectScriptsWithSameDomains(firstParty.concat(thirdParty)),
  }
};

const getFpSummary = async function(datasetElements, fingerprinter) {
  const webpageTags = await getWebpageTags('./datasetWebpageTags_bis.csv');

  const res = {
    attributes: [],
    pages: [],
    domains: [],
    presenceOn: {
      accountCreation: false,
      authentication: false,
      basket: false,
      payment: false,
    }
  };

  datasetElements.forEach(function(element) {
    if(element.origin === fingerprinter) {
      const att =  mergeThisToStringProperty(element.thisToString, element.property) + '|' + getParametersString(element.arguments);
      if(!res.attributes.includes(att)) {
        res.attributes.push(att);
      }
      if(!res.pages.includes(element.webpage)) {
        console.log(element.webpage);
        res.pages.push(element.webpage);
        res.presenceOn.accountCreation = res.presenceOn.accountCreation || webpageTags[element.webpage]['account-creation'];
        res.presenceOn.authentication = res.presenceOn.authentication || webpageTags[element.webpage]['authentication'];
        res.presenceOn.basket = res.presenceOn.basket || webpageTags[element.webpage]['basket-related'];
        res.presenceOn.payment = res.presenceOn.payment || webpageTags[element.webpage]['payment']
      }
      const dom = getFirstSecondDomain(getDomain(element.webpage));
      if(!res.domains.includes(dom)) {
        res.domains.push(dom);
      }
    }
  });




  res.attributes = res.attributes.length;
  res.pages = res.pages.length;
  res.domains = res.domains.length;
  return res;
};

const getAttributesFamilyRepartition = function(datasetElements, fingerprinters, attributeFamily) {
  const attributeFamilyRepartition = {};
  datasetElements.forEach(function (element) {
    if(fingerprinters.includes(element.origin)) {
      let att =  mergeThisToStringProperty(element.thisToString, element.property) + '|' + getParametersString(element.arguments);
      att = att.substring(0, 100);
      let family = attributeFamily[att];
      if(family === undefined || family === 'undefined'){
        family = 'WebRTC';
      }
      if(attributeFamilyRepartition[family] === undefined) {
        attributeFamilyRepartition[family] = [];
      }
      if(!attributeFamilyRepartition[family].includes(element.origin)) {
        attributeFamilyRepartition[family].push(element.origin);
      }
    }
  });

  const res = {};
  Object.keys(attributeFamilyRepartition).forEach(function(key) {
    res[key] = attributeFamilyRepartition[key].length;
  });

  return res;
};

const getDistributionFromPageType = async function(datasetElements, fingerprinters) {
  const tmp = {};
  let average = [];

  const webpageTags = await getWebpageTags('./datasetWebpageTags_bis.csv');

  datasetElements.forEach(function(element) {
    if(fingerprinters.includes(element.origin) && webpageTags[element.webpage] !== undefined) {
      if(!average.includes(element.webpage)) {
        average.push(element.webpage)
      }
      Object.keys(webpageTags[element.webpage]).forEach(function(webpageType) {
        if(webpageTags[element.webpage][webpageType]) {
          if(tmp[webpageType] === undefined) {
            tmp[webpageType] = [];
          }
          if(!tmp[webpageType].includes(element.webpage)) {
            tmp[webpageType].push(element.webpage);
          }
        }
      })
    }
  });

  const res = {};
  Object.keys(tmp).forEach(function(key) {
    res[key] = tmp[key].length;
  });
  console.log('average : ' + average.length);
  return res;
};

const getDistributionFromDomain = async function(datasetElements, fingerprinters, domainTagType) {
  const tmp = {};
  const all = {
    country: {
      'world': 142,
      'united-kingdom': 40,
      russian: 39,
      french: 34,
      germany: 33,
      other: 29,
      china: 28,
      america: 22,
      india: 26,
      japan: 28,
      spanish: 25
    },
    type: {
      'bank': 85,
      business: 38,
      flight: 37,
      adult: 33,
      'cinema-event': 32,
      computers: 29,
      institutional: 27,
      dating: 26,
      'audio-video-streaming': 23,
      'hotel-booking': 22,
      news: 22,
      'financial-cryptocurrency': 20,
      'social-network': 19,
      'work-search': 18,
      games: 15,
    }

  };
  let average = [];

  const domainTags = await getDomainsTags('./datasetdomainTags_bis.csv');

  datasetElements.forEach(function(element) {
    const domain = getFirstSecondDomain(getDomain(element.webpage));
    if(fingerprinters.includes(element.origin) && domainTags[domain] !== undefined) {
      if(domainTags[domain][domainTagType]) {
        if(tmp[domainTags[domain][domainTagType]] === undefined) {
          tmp[domainTags[domain][domainTagType]] = [];
        }
        if(!tmp[domainTags[domain][domainTagType]].includes(domain)) {
          tmp[domainTags[domain][domainTagType]].push(domain);
        }
      }
    }
  });

  const res = {};
  Object.keys(tmp).forEach(function(key) {
    res[key] = tmp[key].length + '/' + all[domainTagType][key] + ' : ' + (tmp[key].length/all[domainTagType][key]);
  });
  return res;
};


const getBotMFADistribution = async function(datasetElements, fingerprinters) {
  const tmp = {
    bot: {},
    mfa: {}
  };

  const webpageTags = await getWebpageTags('./datasetWebpageTags_bis.csv');
  const pageTags = ['account-creation',	'authentication',	'password-forgotten',	'payment', 'basket-related', 'account-settings', 'home', 'content-related']
  datasetElements.forEach(function(element) {
    if(fingerprinters.includes(element.origin) && webpageTags[element.webpage] !== undefined && webpageTags[element.webpage].Bot1 !== '') {
      pageTags.forEach(function(webpageType) {
        if(webpageTags[element.webpage][webpageType]) {
          if(tmp.bot[webpageType] === undefined) {
            tmp.bot[webpageType] = [];
          }
          if(!tmp.bot[webpageType].includes(element.webpage)) {
            tmp.bot[webpageType].push(element.webpage);
          }
        }
      })
    } else if(fingerprinters.includes(element.origin) && webpageTags[element.webpage] !== undefined && webpageTags[element.webpage].MFA1 !== ''){
      pageTags.forEach(function(webpageType) {
        if(webpageTags[element.webpage][webpageType]) {
          if(tmp.mfa[webpageType] === undefined) {
            tmp.mfa[webpageType] = [];
          }
          if(!tmp.mfa[webpageType].includes(element.webpage)) {
            tmp.mfa[webpageType].push(element.webpage);
          }
        }
      })

    }
  });

  const res = {};
  Object.keys(tmp).forEach(function(key) {
    res[key] = {};
    Object.keys(tmp[key]).forEach(function(keyBis) {
      res[key][keyBis] = tmp[key][keyBis].length;
    });
  });
  return res;
};


const getDomainsWithOnlyFPOnSecuredPages = async function(datasetElements, fingerprinters) {
  const webpageTags = await getWebpageTags('./datasetWebpageTags_bis.csv');
  let res = [];
  datasetElements.forEach(function(element){
    if(fingerprinters.includes(element.origin) && webpageTags[element.webpage] !== undefined){
      let secure;
      if(webpageTags[element.webpage]['account-creation'] || webpageTags[element.webpage]['authentication'] || webpageTags[element.webpage]['basket-related'] || webpageTags[element.webpage]['payment']){
        secure = true;
      }

      if(webpageTags[element.webpage]['home'] || webpageTags[element.webpage]['password-forgotten'] || webpageTags[element.webpage]['content-related'] || webpageTags[element.webpage]['account-settings']){
        secure = false;
      }

      const domain = getFirstSecondDomain(getDomain(element.webpage));
      if(secure && !res.includes(domain)){
        console.log(domain);
        res.push(domain);
      } else if(!secure && res.includes(domain)){
        res = res.splice(res.indexOf(domain), 1);
      }
    }
  });

  return res;
};

const getDiffAttributesBetweenFPOnSecuredAndNonSecuredPages = async function(datasetElements, fingerprinters, attributeFamily) {
  const webpageTags = await getWebpageTags('./datasetWebpageTags_bis.csv');

  let fpSecuredScripts = [];
  let fpNonSecuredScripts = [];
  const fpMix = [];


  const tmpFp = [];
  datasetElements.forEach(function(element) {
    if (fingerprinters.includes(element.origin) && webpageTags[element.webpage] !== undefined) {
      if(!tmpFp.includes(element.origin)) {
        tmpFp.push(element.origin);
      }
      let secure;
      if (webpageTags[element.webpage]['account-creation'] || webpageTags[element.webpage]['authentication'] || webpageTags[element.webpage]['basket-related'] || webpageTags[element.webpage]['payment']) {
        secure = true;
      } else {

//      if(webpageTags[element.webpage]['home'] || webpageTags[element.webpage]['password-forgotten'] || webpageTags[element.webpage]['content-related'] || webpageTags[element.webpage]['account-settings']){
        secure = false;
      }

      if (secure && !fpSecuredScripts.includes(element.origin)) {
        fpSecuredScripts.push(element.origin)
      } else if (!secure && !fpNonSecuredScripts.includes(element.origin)) {
        fpNonSecuredScripts.push(element.origin)
      }
      console.log(fpSecuredScripts.length + ' : ' + fpNonSecuredScripts.length + ' : ' + fpMix.length);
    }
  });

  console.log(tmpFp.length);

  const finalFpSecuredScripts = [];
  const finalNonFpSecuredScripts = [];

  fpSecuredScripts.forEach(function(script) {
    if(fpNonSecuredScripts.includes(script)) {
      if(!fpMix.includes(script)) {
        fpMix.push(script);
      }
    } else {
      finalFpSecuredScripts.push(script);
    }
  });

  fpNonSecuredScripts.forEach(function(script) {
    if(fpSecuredScripts.includes(script)) {
      if(!fpMix.includes(script)) {
        fpMix.push(script);
      }
    } else {
      finalNonFpSecuredScripts.push(script);
    }
  });

  fingerprinters.forEach(function(fingerprinter) {
    if(!finalFpSecuredScripts.includes(fingerprinter) && !finalNonFpSecuredScripts.includes(fingerprinter) && !fpMix.includes(fingerprinter)) {
      fpMix.push(fingerprinter);
    }
  });

  console.log('secure : ' + finalFpSecuredScripts.length + ', non secure : ' + finalNonFpSecuredScripts.length + ', mix : ' + fpMix.length);


  const res = {
    secure:{
      attr:[]
    },
    nonSecure:{
      attr:[]
    },
    mix:{
      attr:[]
    },
    diff:{
      attr: []
    }
  };

  datasetElements.forEach(function(element) {
    let att =  mergeThisToStringProperty(element.thisToString, element.property) + '|' + getParametersString(element.arguments);
    if(fpSecuredScripts.includes(element.origin)) {
      if(!res.secure.attr.includes(att))
        res.secure.attr.push(att);
      if(res.secure[attributeFamily[att]] === undefined) {
        res.secure[attributeFamily[att]] = [];
      }
      if(!res.secure[attributeFamily[att]].includes(att)) {
        res.secure[attributeFamily[att]].push(att);
      }
    } else if(fpNonSecuredScripts.includes(element.origin)) {
      if(!res.nonSecure.attr.includes(att))
        res.nonSecure.attr.push(att);

      if(res.nonSecure[attributeFamily[att]] === undefined) {
        res.nonSecure[attributeFamily[att]] = [];
      }
      if(!res.nonSecure[attributeFamily[att]].includes(att)) {
        res.nonSecure[attributeFamily[att]].push(att);
      }
    } else {
      if(!res.mix.attr.includes(att))
        res.mix.attr.push(att);

      if(res.mix[attributeFamily[att]] === undefined) {
        res.mix[attributeFamily[att]] = [];
      }
      if(!res.mix[attributeFamily[att]].includes(att)) {
        res.mix[attributeFamily[att]].push(att);
      }
    }
  });

  res.secure.attr.forEach(function(att){
    if(!res.nonSecure.attr.includes(att)) {
      if(!res.diff.attr.includes(att))
        res.diff.attr.push(att);

      if(res.diff[attributeFamily[att]] === undefined) {
        res.diff[attributeFamily[att]] = [];
      }
      if(!res.diff[attributeFamily[att]].includes(att)) {
        res.diff[attributeFamily[att]].push(att);
      }
    }
  });

  const keys = ['attr', 'audio', 'bot', 'canvas', 'canvasDrawing', 'canvas font', 'font', 'navigator', 'WebGL', 'WebGL drawing', 'WebGL bis', 'WebRTC'];
  console.log('\t: secure\t/ non-secure\t/ mix');
  keys.forEach(function(key) {
    let str = key + '\t: ';
    if(res.secure[key] !== undefined) {
      str += res.secure[key].length;
    } else {
      str += 0;
    }
    str += '\t/ ';

    if(res.nonSecure[key] !== undefined) {
      str += res.nonSecure[key].length;
    } else {
      str += 0;
    }
    str += '\t/ ';

    if(res.mix[key] !== undefined) {
      str += res.mix[key].length;
    } else {
      str += 0;
    }

    str += '\t/ ';
    if(res.diff[key] !== undefined) {
      str += res.diff[key].length;
    } else {
      str += 0;
    }
    console.log(str);
  });




  return {}
};

const getNbPagesWithNbFingerprinters = async function(datasetElements, fingerprinters) {
  const webpageTags = await getWebpageTags('./datasetWebpageTags_bis.csv');

  const pages = {};

  datasetElements.forEach(function(element) {
    if(fingerprinters.includes(element.origin)) {
      if (pages[element.webpage] === undefined) {
        pages[element.webpage] = [];
      }

      if (!pages[element.webpage].includes(element.origin)) {
        pages[element.webpage].push(element.origin);
      }
    }
  });


  const res = {};
  Object.keys(pages).forEach(function(page) {
    if(res[pages[page].length] === undefined) {
      res[pages[page].length] = 1;
    } else {
      res[pages[page].length]++;
    }
  });

  console.log(res);

  const tags = {};
  Object.keys(pages).forEach(function(page) {
    if(pages[page].length > 1) {
      const pageTags = getTagsOfPage(webpageTags, page);
      pageTags.forEach(function(tag) {
        if(tags[tag] === undefined) {
          tags[tag] = 0;
        }

        tags[tag]++;
      });
    }
  });

  const firstThirdMix = {
    first: 0,
    third: 0,
    mix: 0
  };

  Object.keys(pages).forEach(function(page) {
    if(pages[page].length > 1) {
      let first = false;
      let third = false;
      const pageDomain = getFirstSecondDomain(getDomain(page));
      pages[page].forEach(function(fp) {
        const fpDomain = getFirstSecondDomain(getDomain(fp));
        first = first || fpDomain === pageDomain;
        third = third || fpDomain !== pageDomain;
      });
      if(first && third) {
        firstThirdMix.mix++;
      } else if(first) {
        firstThirdMix.first++;
      } else if(third) {
        firstThirdMix.third++;
      }
    }
  });

  console.log(firstThirdMix);

  return tags;
};


const getNbDomainsWithNbFingerprinters = async function(datasetElements, fingerprinters) {
  const domains = {};

  datasetElements.forEach(function(element) {
    const domain = getFirstSecondDomain(getDomain(element.webpage));
    if(fingerprinters.includes(element.origin)) {
      if (domains[domain] === undefined) {
        domains[domain] = [];
      }

      if (!domains[domain].includes(element.origin)) {
        domains[domain].push(element.origin);
      }
    }
  });


  const res = {};
  Object.keys(domains).forEach(function(domain) {
    if(res[domains[domain].length] === undefined) {
      res[domains[domain].length] = 1;
    } else {
      res[domains[domain].length]++;
    }
  });

  console.log(res);
};
const getTagsOfPage = function(webpageTags, page) {
  const pageTags = ['account-creation',	'authentication',	'password-forgotten',	'payment', 'basket-related', 'account-settings', 'home', 'content-related'];
  const res = [];
  if(webpageTags[page] !== undefined) {
    pageTags.forEach(function(pageTag) {
      if(webpageTags[page][pageTag])
        res.push(pageTag);
    });
  }
  return res;
};

const getNbAttributesPerScript = function(datasetElements, fingerprinters) {
  const tmp = {};
  datasetElements.forEach(function(element) {
    if(fingerprinters.includes(element.origin)) {
      if(tmp[element.origin] === undefined) {
        tmp[element.origin] = [];
      }
      const attr = mergeThisToStringProperty(element.thisToString, element.property);
      if(!tmp[element.origin].includes(attr)) {
        tmp[element.origin].push(attr);
      }
    }
  });

  const res = [];
  Object.keys(tmp).forEach(function(script) {
    res.push(tmp[script].length);
  });

  return res;
};

const getDistinctKeys = function() {
  const mr = db.runCommand({
    "mapreduce" : "my_collection",
    "map" : function() {
      for (var key in this) { emit(key, null); }
    },
    "reduce" : function(key, stuff) { return null; },
    "out": "my_collection" + "_keys"
  })

};

const generateUltimateCollection = async function(datasetElements) {
  datasetElements.forEach(function(element) {
    delete(element['_id']);
  });
  const ultimateDataCollection = await mongodb.collection("ultimateData");
  return ultimateDataCollection.insertMany(datasetElements);
};


const storeScript = async function (scriptURL, scriptName) {
  return new Promise(function (resolve, reject) {
    console.log(scriptURL);
    request.get({uri: scriptURL, timeout: 5000}, function (err, response, body) {
      if(body !== undefined & body !== null && body !== '') {
        writeIntoFile('./fingerprinters/' + scriptName + '.js', body);
        resolve();
      }
      resolve();
    });
  });
};

const storeFingerprinters = async function (fingerprinters) {
  console.log(fingerprinters.length);
  for(let i=0;i<fingerprinters.length;i++) {
    const fingerprinter = fingerprinters[i];
    await storeScript(fingerprinter, i);
    console.log(i);
  }
};

const getScriptAttributeFamilyDistribution = function(datasetElements, fingerprinters, attributeFamily) {
  const tmp = {};

  datasetElements.forEach(function(element) {
    if(fingerprinters.includes(element.origin)) {
      if(tmp[element.origin] === undefined) {
        tmp[element.origin] = {
          attributes: [],
        }
      }

      const thisToStringProperty = mergeThisToStringProperty(element.thisToString, element.property);
      const family = attributeFamily[thisToStringProperty];
      if(family === undefined) {
        console.log(element.thisToStringProperty + ' : ' + element.property);
        console.log(thisToStringProperty);
      }
      if(tmp[element.origin][family] === undefined) {
        tmp[element.origin][family] = [];
      }
      if(!tmp[element.origin][family].includes(thisToStringProperty)) {
        tmp[element.origin][family].push(thisToStringProperty)
      }
      if(!tmp[element.origin]['attributes'].includes(thisToStringProperty)) {
        tmp[element.origin]['attributes'].push(thisToStringProperty)
      }
    }
  });

  let done = [];
  const csvElements = [];
  const csvElementsBis = [];

  const csvWriter = createCsvWriter({
    path: 'iterations/final/fingerprintersScriptsAttributesDistribution.csv',
    header: ['fingerprinter', 'family', 'nb'],
  });

  const csvWriterBis = createCsvWriter({
    path: 'iterations/final/fingerprintersScriptsNbAttributes.csv',
    header: ['fingerprinter', 'nb'],
  });

  while(done.length < 169) {
    let max = -1;
    // Get max
    Object.keys(tmp).forEach(function(fingerprinter) {
      if(tmp[fingerprinter].attributes.length > max && !done.includes(fingerprinter)) {
        max = tmp[fingerprinter].attributes.length;
      }
    });

    Object.keys(tmp).forEach(function(fingerprinter) {
      if(max === tmp[fingerprinter].attributes.length){
        done.push(fingerprinter);
        csvElementsBis.push({
          fingerprinter: fingerprinter,
          nb: tmp[fingerprinter].attributes.length
        });
        Object.keys(tmp[fingerprinter]).forEach(function(family) {
          if(family !== 'attributes'){
            csvElements.push({
              fingerprinter: fingerprinter,
              family: family,
              nb: tmp[fingerprinter][family].length
            })
          }
        });
      }
    });
  }


  csvWriter.writeRecords(csvElements).then(() => {
  });
  csvWriterBis.writeRecords(csvElementsBis).then(() => {
  });
};

const getNbAttributesOfNonFingerprinters = function(datasetElements, fingerprinters) {
  const tmp = {};

  datasetElements.forEach(function(element) {
    if(!fingerprinters.includes(element.origin)) {
      if(tmp[element.origin] === undefined) {
        tmp[element.origin] = [];
      }

      const thisToStringProperty = mergeThisToStringProperty(element.thisToString, element.property);
      if(!tmp[element.origin].includes(thisToStringProperty)) {
        tmp[element.origin].push(thisToStringProperty)
      }
    }
  });

  const csvElements = [];
  Object.keys(tmp).forEach(function(fp){
    csvElements.push({'nb':tmp[fp].length});
  });

  const csvWriter = createCsvWriter({
    path: 'iterations/final/nonFingerprintersNbAttributesDistribution.csv',
    header: ['nb'],
  });

  csvWriter.writeRecords(csvElements).then(() => {
  });
}

const getAttributesOfScript = function(datasetElements, script) {
  const attrs = [];
  datasetElements.forEach(function(element){
    if(script === element.origin) {
      const thisToStringProperty = mergeThisToStringProperty(element.thisToStringProperty, element.property);
      if(!attrs.includes(thisToStringProperty)) {
        attrs.push(thisToStringProperty)
      }
    }
  });

  console.log(attrs);
  console.log(attrs.length);
};

const shuffle = function (a) {
  let j, x, i;
  for (i = a.length - 1; i > 0; i--) {
    j = Math.floor(Math.random() * (i + 1));
    x = a[i];
    a[i] = a[j];
    a[j] = x;
  }
  return a;
};

const getRandomScripts = function(number, scripts) {
  scripts = shuffle(scripts);
  return scripts.splice(0, number);
};

const getScripts = function(datasetElements) {
  const scripts = [];
  datasetElements.forEach(function(element){
    if(!scripts.includes(element.origin)) {
      scripts.push(element.origin);
    }
  });

  console.log(scripts.length);
  return scripts;
};

const getWildDatasetElements = function(folderpath) {
  return [];
}

module.exports = {
  getAllFolderElements: getAllFolderElements,
//  getWildDatasetElements: getWildDatasetElements,
  getScriptsElements: getScriptsElements,
//  getSimilarityScore: getSimilarityScore,
  getAttributeParameterListFromData: getAttributeParameterListFromData,
  getDecroissantOrderKeys: getDecroissantOrderKeys,
  getManualClassificationResults: getManualClassificationResults,
  addScriptToManualClassificationFile: addScriptToManualClassificationFile,
//  oneOfNonFingerprintersHasAScoreOfOne: oneOfNonFingerprintersHasAScoreOfOne,
//  getSimilarityScoreForAllDatasetScripts: getSimilarityScoreForAllDatasetScripts,
  getIntersectionsForAllDatasetScripts: getIntersectionsForAllDatasetScripts,
  getHighestIntersectionAndJaccardBetweenDatasetScriptAndScriptsList: getHighestIntersectionAndJaccardBetweenDatasetScriptAndScriptsList,
  getIntersectionAndJaccardBetweenTwoScripts: getIntersectionAndJaccardBetweenTwoScripts,
//  getSimilarityScoreBetweenDatasetScriptAndFingerprinter: getSimilarityScoreBetweenDatasetScriptAndFingerprinter,
  getGroupedScores: getGroupedScores,
  saveJSON: saveJSON,
  loadJSON: loadJSON,
//  getFingerprintersList: getFingerprintersList,
//  getFinalFingerprinters: getFinalFingerprinters,
//  getFpInstances: getFpInstances,
//  getFingerprintersAttribute: getFingerprintersAttribute,
//  getNbNonFingerprintersUsingAttribute: getNbNonFingerprintersUsingAttribute,
//  getAttributeFamily: getAttributeFamily,
//  getScriptsHavingAttributeOfFamily: getScriptsHavingAttributeOfFamily,
//  getIdenticalAttributeOfFamily: getIdenticalAttributeOfFamily,
//  compureDistanceBetweenAllFingerprinters: compureDistanceBetweenAllFingerprinters,
//  getScriptsFromFingerprintJS: getScriptsFromFingerprintJS,
//  getDomainsWitFPOnSignInPages: getDomainsWitFPOnSignInPages,
//  getDomainsHavingABasketPageWithAFingerprinter: getDomainsHavingABasketPageWithAFingerprinter,
//  getFirstThirdPartyFingerprinters: getFirstThirdPartyFingerprinters,
//  getFpSummary: getFpSummary,
//  getAttributesFamilyRepartition: getAttributesFamilyRepartition,
//  getDistributionFromPageType: getDistributionFromPageType,
//  getDistributionFromDomain: getDistributionFromDomain,
//  getDomainsWithOnlyFPOnSecuredPages: getDomainsWithOnlyFPOnSecuredPages,
//  getDiffAttributesBetweenFPOnSecuredAndNonSecuredPages: getDiffAttributesBetweenFPOnSecuredAndNonSecuredPages,
//  getBotMFADistribution: getBotMFADistribution,
//  getNbPagesWithNbFingerprinters: getNbPagesWithNbFingerprinters,
//  getNbAttributesPerScript: getNbAttributesPerScript,
//  getDistinctKeys: getDistinctKeys,
//  generateUltimateCollection: generateUltimateCollection,
//  storeFingerprinters: storeFingerprinters,
//  getScriptAttributeFamilyDistribution: getScriptAttributeFamilyDistribution,
//  getNbAttributesOfNonFingerprinters: getNbAttributesOfNonFingerprinters,
//  getNbDomainsWithNbFingerprinters: getNbDomainsWithNbFingerprinters,
//  getAttributesOfScript: getAttributesOfScript,
//  getDomainsHavingAllTheirBasketPagesWithoutAFingerprinter: getDomainsHavingAllTheirBasketPagesWithoutAFingerprinter,
//  getRandomScripts: getRandomScripts,
//  getScripts: getScripts,
};
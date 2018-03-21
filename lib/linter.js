'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const should = require('should');

let loadedRules;

// TODO Eventually support more than just core files
function deepMergeRules(ruleNickname, skipRules, rules = []) {
  const ruleFile = path.join(__dirname, '../rules/' + ruleNickname + '.json');
  const content = fs.readFileSync(ruleFile, 'utf8');
  const data = yaml.safeLoad(content, { json: true });

  if (typeof data.require == 'string') {
      rules = deepMergeRules(data.require, rules);
  }

  for (const r in data.rules) {
      const rule = data.rules[r];
      if (!rule.enabled) continue;
      if (skipRules.indexOf(rule.name) !== -1) continue;
      if (!Array.isArray(rule.object)) rule.object = [rule.object];
      if (rule.alphabetical && rule.alphabetical.properties && !Array.isArray(rule.alphabetical.properties)) {
          rule.alphabetical.properties = [rule.alphabetical.properties];
      }
      if (rule.truthy && !Array.isArray(rule.truthy)) rule.truthy = [rule.truthy];
      rules.push(rule);
  }

  return rules;
}

function loadRules(loadFiles, skipRules = []) {
    loadedRules = [];

    const files = (loadFiles.length > 0 ? loadFiles : ['default']);

    for (const f in files) {
        loadedRules = loadedRules.concat(deepMergeRules(files[f], skipRules));
    }
}

function ensureRule(context, rule, shouldAssertion, results) {
    try {
        shouldAssertion();
    }
    catch (error) {
        // rethrow when not a lint error
        if (!error.name || error.name !== "AssertionError") throw error;

        const pointer = (context && context.length > 0 ? context[context.length-1] : null);
        const result = { pointer, rule, error };
        results.push(result);
    }
}

function lint(objectName, object, options = {}) {

    function ensure(rule, func) {
        ensureRule(options.context, rule, func, options.lintResults);
    }

    for (const r in loadedRules) {
        const rule = loadedRules[r];
        if ((rule.object[0] === '*') || (rule.object.indexOf(objectName)>=0)) {

            if (rule.skip && options[rule.skip]) {
                continue;
            }
            if (rule.truthy) {
                for (const property of rule.truthy) {
                    ensure(rule, () => {
                        object.should.have.property(property);
                        object[property].should.not.be.empty();
                    });
                }
            }
            if (rule.alphabetical) {
                for (const property of rule.alphabetical.properties) {
                    if (!object[property] || object[property].length < 2) {
                        continue;
                    }

                    const arrayCopy = object[property].slice(0);

                    // If we aren't expecting an object keyed by a specific property, then treat the
                    // object as a simple array.
                    if (rule.alphabetical.keyedBy) {
                        const keyedBy = [rule.alphabetical.keyedBy];
                        arrayCopy.sort(function (a, b) {
                            if (a[keyedBy] < b[keyedBy]) {
                                return -1;
                            }
                            else if (a[keyedBy] > b[keyedBy]) {
                                return 1;
                            }
                            return 0;
                        });
                    }
                    else {
                        arrayCopy.sort()
                    }
                    ensure(rule, () => {
                        object.should.have.property(property);
                        object[property].should.be.deepEqual(arrayCopy);
                    });
                }
            }
            if (rule.properties) {
                ensure(rule, () => {
                    should(Object.keys(object).length).be.exactly(rule.properties);
                });
            }
            if (rule.or) {
                let found = false;
                for (const property of rule.or) {
                    if (typeof object[property] !== 'undefined') found = true;
                }
                ensure(rule, () => {
                    found.should.be.exactly(true,rule.description);
                });
            }
            if (rule.xor) {
                let found = false;
                for (const property of rule.xor) {
                    if (typeof object[property] !== 'undefined') {
                        if (found) {
                            ensure(rule, () => {
                                should.fail(true,false,rule.description);
                            });
                        }
                        found = true;
                    }
                }
                ensure(rule, () => {
                    found.should.be.exactly(true,rule.description);
                });
            }
            if (rule.pattern) {
                const { omit, property, split, value } = rule.pattern;
                const target = object[property]

                let components = [];
                if (split) {
                    components = target.split(split);
                }
                else {
                    components.push(target);
                }
                const re = new RegExp(value);
                for (let component of components) {
                    if (omit) component = component.split(omit).join('');
                    if (component) {
                        ensure(rule, () => {
                            should(re.test(component)).be.exactly(true, rule.description);
                        });
                    }
                }
            }
            if (rule.notContain) {
                const { value, properties } = rule.notContain;
                for (const property of properties) {
                    if (object[property] && (typeof object[property] === 'string') &&
                        (object[property].indexOf(value) >= 0)) {
                            ensure(rule, () => {
                                should.fail(true,false,rule.description);
                            });
                    }
                }
            }
            if (rule.notEndWith) {
                const { value, property } = rule.notEndWith;
                ensure(rule, () => {
                    should(object[property]).not.endWith(value)
                });
            }
            if (rule.maxLength) {
                const { value, property } = rule.maxLength;
                if (object[property] && (typeof object[property] === 'string')) {
                    ensure(rule, () => {
                        object.should.have.property(property).with.lengthOf(value);
                    });
                }
            }
        }
    }
}

module.exports = {
    lint,
    loadRules
};
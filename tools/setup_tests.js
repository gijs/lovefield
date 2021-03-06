/**
 * @license
 * Copyright 2014 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var fork = /** @type {{fork: !Function}} */ (require('child_process')).fork;
var fsMod = require('fs');
var glob = /** @type {{sync: !Function}} */ (require('glob')).sync;
var mkdir = /** @type {{sync: !Function}} */ (require('mkdirp')).sync;
var pathMod = require('path');
var rmdir = /** @type {{sync: !Function}} */ (require('rimraf')).sync;
var temp = /** @type {{Dir: !Function}} */ (require('temporary'));


/**
 * @type {{
 *   CLOSURE_LIBRARY_PATH: string,
 *   TEST_SCHEMAS: !Array.<{file: string, namespace: string}>
 *   }
 * }}
 */
var config = /** @type {!Function} */ (require(
    pathMod.resolve(__dirname + '/config.js')))();
var genDeps = /** @type {!Function} */ (require(
    pathMod.join(__dirname, 'scan_deps.js')).genDeps);
var extractRequires = /** @type {!Function} */ (require(
    pathMod.join(__dirname, 'scan_deps.js')).extractRequires);
var generateTestSchemas = /** @type {!Function} */ (require(
    pathMod.join(__dirname, 'builder.js')).generateTestSchemas);



// Make linter happy.
var log = console['log'];


/** @const {!Array<string>} */
var SYMLINKS = ['lib', 'perf', 'testing', 'tests'];


/**
 * Creates a temporary directory that is capable of executing tests.
 * @return {!IThenable<string>} A promise holding the path of the temporary
 *     directory.
 */
function createTestEnv() {
  var tempPath = pathMod.resolve(new temp.Dir().path);
  var origPath = process.cwd();
  process.chdir(tempPath);

  var genDir = pathMod.join(tempPath, 'gen');
  fsMod.mkdirSync('html');
  var htmlDir = pathMod.join(tempPath, 'html');
  return generateTestSchemas(genDir).then(
      function() {
        createSymLinks(config.CLOSURE_LIBRARY_PATH, tempPath);
        createTestFiles();
        var directories = SYMLINKS.map(
            function(dir) {
              return pathMod.join(tempPath, dir);
            }).concat([htmlDir, genDir]);
        var deps = genDeps(tempPath, directories);
        fsMod.writeFileSync('deps.js', deps);
        return tempPath;
      },
      function(e) {
        process.chdir(origPath);
        cleanUp(tempPath);
        throw e;
      });
}


/**
 * Creates symbolic links to Closure and Lovefield.
 * @param {string} libraryPath Closure library path.
 * @param {string} tempPath Test environment path.
 */
function createSymLinks(libraryPath, tempPath) {
  fsMod.symlinkSync(
      pathMod.resolve(pathMod.join(libraryPath, 'closure')),
      pathMod.join(tempPath, 'closure'),
      'junction');
  SYMLINKS.forEach(function(link) {
    fsMod.symlinkSync(
        pathMod.resolve(pathMod.join(__dirname, '../' + link)),
        pathMod.join(tempPath, link),
        'junction');
  });
}


/** Removes previously created symbolic links */
function removeSymLinks() {
  fsMod.unlinkSync('closure');
  SYMLINKS.forEach(function(link) {
    fsMod.unlinkSync(link);
  });
}


/** Creates stub HTML for test files */
function createTestFiles() {
  var testFiles = glob('tests/**/*_test.js');
  log('Generating ' + testFiles.length + ' test files ... ');
  var files = testFiles.map(function(name, index) {
    return createTestFile(name);
  });

  var links = files.map(function(file) {
    return '    <a href="' + file + '">' + file.slice(5) + '</a><br />';
  });
  var contents =
      '<!DOCTYPE html>\r\n' +
      '<html>\r\n' +
      '  <head>\r\n' +
      '    <meta charset="utf-8" />\r\n' +
      '    <title>Lovefield tests</title>\r\n' +
      '  </head>\r\n' +
      '  <body>\r\n' +
      '    <h1>Lovefield tests</h1>\r\n' +
      links.join('\r\n') +
      '\r\n  </body>\r\n' +
      '</html>\r\n';
  fsMod.writeFileSync('index.html', contents);
  log('\nTest files generated. Starting server ...\n');
}


/**
 * @param {string} script Path of the script, e.g. tests/foo_test.js.
 * @return {string} Generated file path.
 */
function createTestFile(script) {
  var target = 'html/' + script.slice(6, -2) + 'html';
  var level = target.match(/\//g).length;
  var prefix = new Array(level).join('../') + '../';
  var fakeName = script.replace('/', '$').replace('.', '_');
  var scriptPath = pathMod.resolve(pathMod.join(__dirname, '../' + script));
  var contents =
      '<!DOCTYPE html>\r\n' +
      '<html>\r\n' +
      '  <head>\r\n' +
      '    <meta charset="utf-8" />\r\n' +
      '    <title>' + pathMod.basename(target).slice(0, -5) + '</title>\r\n' +
      '    <script src="' + prefix + 'closure/goog/base.js"></script>\r\n' +
      '    <script src="' + prefix + 'deps.js"></script>\r\n' +
      '  </head>\r\n' +
      '  <body>\r\n' +
      '    <script>\r\n' +
      '      goog.addDependency(\r\n' +
      '          \'../' + prefix + script + '\',\r\n' +
      '          [\'' + fakeName + '\'],\r\n' +
      '          [' + extractRequires(scriptPath) + '], false);\r\n' +
      '      goog.require(\'goog.testing.AsyncTestCase\');\r\n' +
      '      goog.require(\'goog.testing.jsunit\');\r\n' +
      '      goog.require(\'' + fakeName + '\');\r\n' +
      '    </script>\r\n' +
      '  </body>\r\n' +
      '</html>\r\n';
  mkdir(pathMod.dirname(target));
  fsMod.writeFileSync(target, contents);
  return target;
}


/**
 * Removes temp folder.
 * @param {string} tempPath
 */
function cleanUp(tempPath) {
  var origPath = process.cwd();
  removeSymLinks();
  process.chdir(origPath);
  rmdir(tempPath);
}


/** @type {!Function} */
exports.createTestEnv = createTestEnv;


/** @type {!Function} */
exports.cleanUp = cleanUp;

module.exports = function(RED) {
  "use strict";
  var util = require("util");
  var vm = require("vm");
  var fs = require("fs");
  var path = require("path");
  var mkdirp = require("mkdirp");

  var ensurePath = function(filename){
    mkdirp.sync(path.dirname(filename))
  }

  var createEmpty = function(filename,defaultContenue) {
    fs.writeFile(filename, (defaultContenue|| ""), function (err) {
      if (err) throw err;
    });
  }

  function readFile(filename, z, callback){
    var pathToFile = "";
    var contenue = "return msg;";
    if (filename !== '' && typeof(filename) != "undefined") {
      pathToFile = getScriptPath(filename,z);
      ensurePath(pathToFile);
      fs.readFile(pathToFile, {encoding: 'utf-8'}, function (err, fileContent) {
        if (err) {
          if (err.code === 'ENOENT') {
            createEmpty(pathToFile,contenue);
            err = undefined;
          }
        } else {
          contenue = fileContent;
        }
        callback (err, contenue);
      });
    } else {
      callback ({code:1,message:"no filename"});
    }
  }

  function getScriptPath(filename, z) {
    var pathToFile = filename;

    if(filename.indexOf('/') != 0) {
      var flows = RED.nodes.getFlows();
      var basePath = "/root/userdir";
      for (var i in flows){
        if (flows[i].id == z){
          if (flows[i].hasOwnProperty("origin")){
            basePath = path.dirname(flows[i].origin);
            break;
          }
        }
      }
      pathToFile = path.join(basePath, filename);
    }
    return pathToFile;
  }

  function main(config) {
    RED.nodes.createNode(this, config);

    this.filename = config.filename || "";
    this.reloadfile = config.reloadfile;
    this.loadedScript = '';

    var node = this;
    readFile(node.filename, node.z, function(err,data){
      if (err){
        return;
      } else {
        node.loadedScript = data;
      }
    });

    this.on("input", function (msg) {
      var filename = node.filename;
      if(typeof(msg.filename) != "undefined" && msg.filename != ""){filename = msg.filename;}
      if (filename === '') {
        node.error('No filename specified');
      } else if (node.reloadfile === false && filename === node.filename && node.loadedScript !== ''){
        runScript(node, msg, node.loadedScript);
      } else {
        ensurePath(node.filename);
        readFile(filename, node.z, function(err,data){
          if (err){
            msg.error = err;
          } else {
            node.loadedScript = data;
            runScript(node, msg, node.loadedScript);
          }
        });
      }
    });
  }
  RED.nodes.registerType("file function", main);

  function runScript(node, msg, script) {
    var functionText = "var results = null; results = (function(msg){"+script+"\n})(msg);";

    var sandbox = {
        console: console,
        util: util,
        Buffer: Buffer,
        Date: Date,
        RED: {
            util: RED.util
        },
        __node__: {
            log: function() {
                node.log.apply(node, arguments);
            },
            error: function() {
                node.error.apply(node, arguments);
            },
            warn: function() {
                node.warn.apply(node, arguments);
            },
            send: function(id, msgs) {
                sendResults(node, id, msgs);
            },
            on: function() {
                if (arguments[0] === "input") {
                    throw new Error(RED._("function.error.inputListener"));
                }
                node.on.apply(node, arguments);
            },
            status: function() {
                node.status.apply(node, arguments);
            }
        },
        context: {
            set: function() {
                node.context().set.apply(node,arguments);
            },
            get: function() {
                return node.context().get.apply(node,arguments);
            },
            keys: function() {
                return node.context().keys.apply(node,arguments);
            },
            get global() {
                return node.context().global;
            },
            get flow() {
                return node.context().flow;
            }
        },
        flow: {
            set: function() {
                node.context().flow.set.apply(node,arguments);
            },
            get: function() {
                return node.context().flow.get.apply(node,arguments);
            },
            keys: function() {
                return node.context().flow.keys.apply(node,arguments);
            }
        },
        global:RED.settings.functionGlobalContext || {},
        setTimeout: function () {
            var func = arguments[0];
            var timerId;
            arguments[0] = function() {
                sandbox.clearTimeout(timerId);
                try {
                    func.apply(this,arguments);
                } catch(err) {
                    node.error(err,{});
                }
            };
            timerId = setTimeout.apply(this,arguments);
            node.outstandingTimers.push(timerId);
            return timerId;
        },
        clearTimeout: function(id) {
            clearTimeout(id);
            var index = node.outstandingTimers.indexOf(id);
            if (index > -1) {
                node.outstandingTimers.splice(index,1);
            }
        },
        setInterval: function() {
            var func = arguments[0];
            var timerId;
            arguments[0] = function() {
                try {
                    func.apply(this,arguments);
                } catch(err) {
                    node.error(err,{});
                }
            };
            timerId = setInterval.apply(this,arguments);
            node.outstandingIntervals.push(timerId);
            return timerId;
        },
        clearInterval: function(id) {
            clearInterval(id);
            var index = node.outstandingIntervals.indexOf(id);
            if (index > -1) {
                node.outstandingIntervals.splice(index,1);
            }
        }
    };

    var context = vm.createContext(sandbox);
    var vmScript = vm.createScript(functionText);

    try {
      var start = process.hrtime();
      context.msg = msg;
      vmScript.runInContext(context);
      var results = context.results;
      if (results == null) {
        results = [];
      } else if (results.length == null) {
        results = [results];
      }

      if (msg.topic) {
        for (var m in results) {
          if (results[m]) {
            if (util.isArray(results[m])) {
              for (var n=0; n < results[m].length; n++) {
                results[m][n].topic = msg.topic;
              }
            } else {
              results[m].topic = msg.topic;
            }
          }
        }
      }

      node.send(results);
      var duration = process.hrtime(start);
      if (process.env.NODE_RED_FUNCTION_TIME) {
        this.status({fill:"yellow",shape:"dot",text:""+Math.floor((duration[0]* 1e9 + duration[1])/10000)/100});
      }

    } catch(err) {
      node.warn(err);
    }
  }

  RED.library.register("functions");

  RED.httpAdmin.get('/file-function/load', function(req, res){
    var filename = req.query.filename;
    var z = req.query.z;
    if(filename){
      readFile(filename, z, function(err,data){
        if (err){
          console.log(err);
          res.send("");
        } else {
          res.send(data);
        }
      });
    }
  });

  RED.httpAdmin.get('/file-function/write', function(req, res){
    var filename = req.query.filename;
    var content = req.query.content;
    var z = req.query.z;
    if(filename){
      var pathToFile = getScriptPath(filename,z);
      ensurePath(pathToFile);
      fs.writeFile(pathToFile, content, {encoding: 'utf-8'},function (err, fileContent) {
        if (err) {
          console.log(err);
          res.send(err);
        } else {
          res.send("ok");
        }
      });
    }
  });
};

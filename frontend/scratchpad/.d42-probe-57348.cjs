var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all3) => {
  for (var name in all3)
    __defProp(target, name, { get: all3[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/delayed-stream/lib/delayed_stream.js
var require_delayed_stream = __commonJS({
  "node_modules/delayed-stream/lib/delayed_stream.js"(exports2, module2) {
    var Stream = require("stream").Stream;
    var util4 = require("util");
    module2.exports = DelayedStream;
    function DelayedStream() {
      this.source = null;
      this.dataSize = 0;
      this.maxDataSize = 1024 * 1024;
      this.pauseStream = true;
      this._maxDataSizeExceeded = false;
      this._released = false;
      this._bufferedEvents = [];
    }
    util4.inherits(DelayedStream, Stream);
    DelayedStream.create = function(source, options) {
      var delayedStream = new this();
      options = options || {};
      for (var option in options) {
        delayedStream[option] = options[option];
      }
      delayedStream.source = source;
      var realEmit = source.emit;
      source.emit = function() {
        delayedStream._handleEmit(arguments);
        return realEmit.apply(source, arguments);
      };
      source.on("error", function() {
      });
      if (delayedStream.pauseStream) {
        source.pause();
      }
      return delayedStream;
    };
    Object.defineProperty(DelayedStream.prototype, "readable", {
      configurable: true,
      enumerable: true,
      get: function() {
        return this.source.readable;
      }
    });
    DelayedStream.prototype.setEncoding = function() {
      return this.source.setEncoding.apply(this.source, arguments);
    };
    DelayedStream.prototype.resume = function() {
      if (!this._released) {
        this.release();
      }
      this.source.resume();
    };
    DelayedStream.prototype.pause = function() {
      this.source.pause();
    };
    DelayedStream.prototype.release = function() {
      this._released = true;
      this._bufferedEvents.forEach(function(args) {
        this.emit.apply(this, args);
      }.bind(this));
      this._bufferedEvents = [];
    };
    DelayedStream.prototype.pipe = function() {
      var r = Stream.prototype.pipe.apply(this, arguments);
      this.resume();
      return r;
    };
    DelayedStream.prototype._handleEmit = function(args) {
      if (this._released) {
        this.emit.apply(this, args);
        return;
      }
      if (args[0] === "data") {
        this.dataSize += args[1].length;
        this._checkIfMaxDataSizeExceeded();
      }
      this._bufferedEvents.push(args);
    };
    DelayedStream.prototype._checkIfMaxDataSizeExceeded = function() {
      if (this._maxDataSizeExceeded) {
        return;
      }
      if (this.dataSize <= this.maxDataSize) {
        return;
      }
      this._maxDataSizeExceeded = true;
      var message = "DelayedStream#maxDataSize of " + this.maxDataSize + " bytes exceeded.";
      this.emit("error", new Error(message));
    };
  }
});

// node_modules/combined-stream/lib/combined_stream.js
var require_combined_stream = __commonJS({
  "node_modules/combined-stream/lib/combined_stream.js"(exports2, module2) {
    var util4 = require("util");
    var Stream = require("stream").Stream;
    var DelayedStream = require_delayed_stream();
    module2.exports = CombinedStream;
    function CombinedStream() {
      this.writable = false;
      this.readable = true;
      this.dataSize = 0;
      this.maxDataSize = 2 * 1024 * 1024;
      this.pauseStreams = true;
      this._released = false;
      this._streams = [];
      this._currentStream = null;
      this._insideLoop = false;
      this._pendingNext = false;
    }
    util4.inherits(CombinedStream, Stream);
    CombinedStream.create = function(options) {
      var combinedStream = new this();
      options = options || {};
      for (var option in options) {
        combinedStream[option] = options[option];
      }
      return combinedStream;
    };
    CombinedStream.isStreamLike = function(stream4) {
      return typeof stream4 !== "function" && typeof stream4 !== "string" && typeof stream4 !== "boolean" && typeof stream4 !== "number" && !Buffer.isBuffer(stream4);
    };
    CombinedStream.prototype.append = function(stream4) {
      var isStreamLike = CombinedStream.isStreamLike(stream4);
      if (isStreamLike) {
        if (!(stream4 instanceof DelayedStream)) {
          var newStream = DelayedStream.create(stream4, {
            maxDataSize: Infinity,
            pauseStream: this.pauseStreams
          });
          stream4.on("data", this._checkDataSize.bind(this));
          stream4 = newStream;
        }
        this._handleErrors(stream4);
        if (this.pauseStreams) {
          stream4.pause();
        }
      }
      this._streams.push(stream4);
      return this;
    };
    CombinedStream.prototype.pipe = function(dest, options) {
      Stream.prototype.pipe.call(this, dest, options);
      this.resume();
      return dest;
    };
    CombinedStream.prototype._getNext = function() {
      this._currentStream = null;
      if (this._insideLoop) {
        this._pendingNext = true;
        return;
      }
      this._insideLoop = true;
      try {
        do {
          this._pendingNext = false;
          this._realGetNext();
        } while (this._pendingNext);
      } finally {
        this._insideLoop = false;
      }
    };
    CombinedStream.prototype._realGetNext = function() {
      var stream4 = this._streams.shift();
      if (typeof stream4 == "undefined") {
        this.end();
        return;
      }
      if (typeof stream4 !== "function") {
        this._pipeNext(stream4);
        return;
      }
      var getStream = stream4;
      getStream(function(stream5) {
        var isStreamLike = CombinedStream.isStreamLike(stream5);
        if (isStreamLike) {
          stream5.on("data", this._checkDataSize.bind(this));
          this._handleErrors(stream5);
        }
        this._pipeNext(stream5);
      }.bind(this));
    };
    CombinedStream.prototype._pipeNext = function(stream4) {
      this._currentStream = stream4;
      var isStreamLike = CombinedStream.isStreamLike(stream4);
      if (isStreamLike) {
        stream4.on("end", this._getNext.bind(this));
        stream4.pipe(this, { end: false });
        return;
      }
      var value = stream4;
      this.write(value);
      this._getNext();
    };
    CombinedStream.prototype._handleErrors = function(stream4) {
      var self2 = this;
      stream4.on("error", function(err) {
        self2._emitError(err);
      });
    };
    CombinedStream.prototype.write = function(data) {
      this.emit("data", data);
    };
    CombinedStream.prototype.pause = function() {
      if (!this.pauseStreams) {
        return;
      }
      if (this.pauseStreams && this._currentStream && typeof this._currentStream.pause == "function") this._currentStream.pause();
      this.emit("pause");
    };
    CombinedStream.prototype.resume = function() {
      if (!this._released) {
        this._released = true;
        this.writable = true;
        this._getNext();
      }
      if (this.pauseStreams && this._currentStream && typeof this._currentStream.resume == "function") this._currentStream.resume();
      this.emit("resume");
    };
    CombinedStream.prototype.end = function() {
      this._reset();
      this.emit("end");
    };
    CombinedStream.prototype.destroy = function() {
      this._reset();
      this.emit("close");
    };
    CombinedStream.prototype._reset = function() {
      this.writable = false;
      this._streams = [];
      this._currentStream = null;
    };
    CombinedStream.prototype._checkDataSize = function() {
      this._updateDataSize();
      if (this.dataSize <= this.maxDataSize) {
        return;
      }
      var message = "DelayedStream#maxDataSize of " + this.maxDataSize + " bytes exceeded.";
      this._emitError(new Error(message));
    };
    CombinedStream.prototype._updateDataSize = function() {
      this.dataSize = 0;
      var self2 = this;
      this._streams.forEach(function(stream4) {
        if (!stream4.dataSize) {
          return;
        }
        self2.dataSize += stream4.dataSize;
      });
      if (this._currentStream && this._currentStream.dataSize) {
        this.dataSize += this._currentStream.dataSize;
      }
    };
    CombinedStream.prototype._emitError = function(err) {
      this._reset();
      this.emit("error", err);
    };
  }
});

// node_modules/mime-db/db.json
var require_db = __commonJS({
  "node_modules/mime-db/db.json"(exports2, module2) {
    module2.exports = {
      "application/1d-interleaved-parityfec": {
        source: "iana"
      },
      "application/3gpdash-qoe-report+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/3gpp-ims+xml": {
        source: "iana",
        compressible: true
      },
      "application/3gpphal+json": {
        source: "iana",
        compressible: true
      },
      "application/3gpphalforms+json": {
        source: "iana",
        compressible: true
      },
      "application/a2l": {
        source: "iana"
      },
      "application/ace+cbor": {
        source: "iana"
      },
      "application/activemessage": {
        source: "iana"
      },
      "application/activity+json": {
        source: "iana",
        compressible: true
      },
      "application/alto-costmap+json": {
        source: "iana",
        compressible: true
      },
      "application/alto-costmapfilter+json": {
        source: "iana",
        compressible: true
      },
      "application/alto-directory+json": {
        source: "iana",
        compressible: true
      },
      "application/alto-endpointcost+json": {
        source: "iana",
        compressible: true
      },
      "application/alto-endpointcostparams+json": {
        source: "iana",
        compressible: true
      },
      "application/alto-endpointprop+json": {
        source: "iana",
        compressible: true
      },
      "application/alto-endpointpropparams+json": {
        source: "iana",
        compressible: true
      },
      "application/alto-error+json": {
        source: "iana",
        compressible: true
      },
      "application/alto-networkmap+json": {
        source: "iana",
        compressible: true
      },
      "application/alto-networkmapfilter+json": {
        source: "iana",
        compressible: true
      },
      "application/alto-updatestreamcontrol+json": {
        source: "iana",
        compressible: true
      },
      "application/alto-updatestreamparams+json": {
        source: "iana",
        compressible: true
      },
      "application/aml": {
        source: "iana"
      },
      "application/andrew-inset": {
        source: "iana",
        extensions: ["ez"]
      },
      "application/applefile": {
        source: "iana"
      },
      "application/applixware": {
        source: "apache",
        extensions: ["aw"]
      },
      "application/at+jwt": {
        source: "iana"
      },
      "application/atf": {
        source: "iana"
      },
      "application/atfx": {
        source: "iana"
      },
      "application/atom+xml": {
        source: "iana",
        compressible: true,
        extensions: ["atom"]
      },
      "application/atomcat+xml": {
        source: "iana",
        compressible: true,
        extensions: ["atomcat"]
      },
      "application/atomdeleted+xml": {
        source: "iana",
        compressible: true,
        extensions: ["atomdeleted"]
      },
      "application/atomicmail": {
        source: "iana"
      },
      "application/atomsvc+xml": {
        source: "iana",
        compressible: true,
        extensions: ["atomsvc"]
      },
      "application/atsc-dwd+xml": {
        source: "iana",
        compressible: true,
        extensions: ["dwd"]
      },
      "application/atsc-dynamic-event-message": {
        source: "iana"
      },
      "application/atsc-held+xml": {
        source: "iana",
        compressible: true,
        extensions: ["held"]
      },
      "application/atsc-rdt+json": {
        source: "iana",
        compressible: true
      },
      "application/atsc-rsat+xml": {
        source: "iana",
        compressible: true,
        extensions: ["rsat"]
      },
      "application/atxml": {
        source: "iana"
      },
      "application/auth-policy+xml": {
        source: "iana",
        compressible: true
      },
      "application/bacnet-xdd+zip": {
        source: "iana",
        compressible: false
      },
      "application/batch-smtp": {
        source: "iana"
      },
      "application/bdoc": {
        compressible: false,
        extensions: ["bdoc"]
      },
      "application/beep+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/calendar+json": {
        source: "iana",
        compressible: true
      },
      "application/calendar+xml": {
        source: "iana",
        compressible: true,
        extensions: ["xcs"]
      },
      "application/call-completion": {
        source: "iana"
      },
      "application/cals-1840": {
        source: "iana"
      },
      "application/captive+json": {
        source: "iana",
        compressible: true
      },
      "application/cbor": {
        source: "iana"
      },
      "application/cbor-seq": {
        source: "iana"
      },
      "application/cccex": {
        source: "iana"
      },
      "application/ccmp+xml": {
        source: "iana",
        compressible: true
      },
      "application/ccxml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["ccxml"]
      },
      "application/cdfx+xml": {
        source: "iana",
        compressible: true,
        extensions: ["cdfx"]
      },
      "application/cdmi-capability": {
        source: "iana",
        extensions: ["cdmia"]
      },
      "application/cdmi-container": {
        source: "iana",
        extensions: ["cdmic"]
      },
      "application/cdmi-domain": {
        source: "iana",
        extensions: ["cdmid"]
      },
      "application/cdmi-object": {
        source: "iana",
        extensions: ["cdmio"]
      },
      "application/cdmi-queue": {
        source: "iana",
        extensions: ["cdmiq"]
      },
      "application/cdni": {
        source: "iana"
      },
      "application/cea": {
        source: "iana"
      },
      "application/cea-2018+xml": {
        source: "iana",
        compressible: true
      },
      "application/cellml+xml": {
        source: "iana",
        compressible: true
      },
      "application/cfw": {
        source: "iana"
      },
      "application/city+json": {
        source: "iana",
        compressible: true
      },
      "application/clr": {
        source: "iana"
      },
      "application/clue+xml": {
        source: "iana",
        compressible: true
      },
      "application/clue_info+xml": {
        source: "iana",
        compressible: true
      },
      "application/cms": {
        source: "iana"
      },
      "application/cnrp+xml": {
        source: "iana",
        compressible: true
      },
      "application/coap-group+json": {
        source: "iana",
        compressible: true
      },
      "application/coap-payload": {
        source: "iana"
      },
      "application/commonground": {
        source: "iana"
      },
      "application/conference-info+xml": {
        source: "iana",
        compressible: true
      },
      "application/cose": {
        source: "iana"
      },
      "application/cose-key": {
        source: "iana"
      },
      "application/cose-key-set": {
        source: "iana"
      },
      "application/cpl+xml": {
        source: "iana",
        compressible: true,
        extensions: ["cpl"]
      },
      "application/csrattrs": {
        source: "iana"
      },
      "application/csta+xml": {
        source: "iana",
        compressible: true
      },
      "application/cstadata+xml": {
        source: "iana",
        compressible: true
      },
      "application/csvm+json": {
        source: "iana",
        compressible: true
      },
      "application/cu-seeme": {
        source: "apache",
        extensions: ["cu"]
      },
      "application/cwt": {
        source: "iana"
      },
      "application/cybercash": {
        source: "iana"
      },
      "application/dart": {
        compressible: true
      },
      "application/dash+xml": {
        source: "iana",
        compressible: true,
        extensions: ["mpd"]
      },
      "application/dash-patch+xml": {
        source: "iana",
        compressible: true,
        extensions: ["mpp"]
      },
      "application/dashdelta": {
        source: "iana"
      },
      "application/davmount+xml": {
        source: "iana",
        compressible: true,
        extensions: ["davmount"]
      },
      "application/dca-rft": {
        source: "iana"
      },
      "application/dcd": {
        source: "iana"
      },
      "application/dec-dx": {
        source: "iana"
      },
      "application/dialog-info+xml": {
        source: "iana",
        compressible: true
      },
      "application/dicom": {
        source: "iana"
      },
      "application/dicom+json": {
        source: "iana",
        compressible: true
      },
      "application/dicom+xml": {
        source: "iana",
        compressible: true
      },
      "application/dii": {
        source: "iana"
      },
      "application/dit": {
        source: "iana"
      },
      "application/dns": {
        source: "iana"
      },
      "application/dns+json": {
        source: "iana",
        compressible: true
      },
      "application/dns-message": {
        source: "iana"
      },
      "application/docbook+xml": {
        source: "apache",
        compressible: true,
        extensions: ["dbk"]
      },
      "application/dots+cbor": {
        source: "iana"
      },
      "application/dskpp+xml": {
        source: "iana",
        compressible: true
      },
      "application/dssc+der": {
        source: "iana",
        extensions: ["dssc"]
      },
      "application/dssc+xml": {
        source: "iana",
        compressible: true,
        extensions: ["xdssc"]
      },
      "application/dvcs": {
        source: "iana"
      },
      "application/ecmascript": {
        source: "iana",
        compressible: true,
        extensions: ["es", "ecma"]
      },
      "application/edi-consent": {
        source: "iana"
      },
      "application/edi-x12": {
        source: "iana",
        compressible: false
      },
      "application/edifact": {
        source: "iana",
        compressible: false
      },
      "application/efi": {
        source: "iana"
      },
      "application/elm+json": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/elm+xml": {
        source: "iana",
        compressible: true
      },
      "application/emergencycalldata.cap+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/emergencycalldata.comment+xml": {
        source: "iana",
        compressible: true
      },
      "application/emergencycalldata.control+xml": {
        source: "iana",
        compressible: true
      },
      "application/emergencycalldata.deviceinfo+xml": {
        source: "iana",
        compressible: true
      },
      "application/emergencycalldata.ecall.msd": {
        source: "iana"
      },
      "application/emergencycalldata.providerinfo+xml": {
        source: "iana",
        compressible: true
      },
      "application/emergencycalldata.serviceinfo+xml": {
        source: "iana",
        compressible: true
      },
      "application/emergencycalldata.subscriberinfo+xml": {
        source: "iana",
        compressible: true
      },
      "application/emergencycalldata.veds+xml": {
        source: "iana",
        compressible: true
      },
      "application/emma+xml": {
        source: "iana",
        compressible: true,
        extensions: ["emma"]
      },
      "application/emotionml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["emotionml"]
      },
      "application/encaprtp": {
        source: "iana"
      },
      "application/epp+xml": {
        source: "iana",
        compressible: true
      },
      "application/epub+zip": {
        source: "iana",
        compressible: false,
        extensions: ["epub"]
      },
      "application/eshop": {
        source: "iana"
      },
      "application/exi": {
        source: "iana",
        extensions: ["exi"]
      },
      "application/expect-ct-report+json": {
        source: "iana",
        compressible: true
      },
      "application/express": {
        source: "iana",
        extensions: ["exp"]
      },
      "application/fastinfoset": {
        source: "iana"
      },
      "application/fastsoap": {
        source: "iana"
      },
      "application/fdt+xml": {
        source: "iana",
        compressible: true,
        extensions: ["fdt"]
      },
      "application/fhir+json": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/fhir+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/fido.trusted-apps+json": {
        compressible: true
      },
      "application/fits": {
        source: "iana"
      },
      "application/flexfec": {
        source: "iana"
      },
      "application/font-sfnt": {
        source: "iana"
      },
      "application/font-tdpfr": {
        source: "iana",
        extensions: ["pfr"]
      },
      "application/font-woff": {
        source: "iana",
        compressible: false
      },
      "application/framework-attributes+xml": {
        source: "iana",
        compressible: true
      },
      "application/geo+json": {
        source: "iana",
        compressible: true,
        extensions: ["geojson"]
      },
      "application/geo+json-seq": {
        source: "iana"
      },
      "application/geopackage+sqlite3": {
        source: "iana"
      },
      "application/geoxacml+xml": {
        source: "iana",
        compressible: true
      },
      "application/gltf-buffer": {
        source: "iana"
      },
      "application/gml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["gml"]
      },
      "application/gpx+xml": {
        source: "apache",
        compressible: true,
        extensions: ["gpx"]
      },
      "application/gxf": {
        source: "apache",
        extensions: ["gxf"]
      },
      "application/gzip": {
        source: "iana",
        compressible: false,
        extensions: ["gz"]
      },
      "application/h224": {
        source: "iana"
      },
      "application/held+xml": {
        source: "iana",
        compressible: true
      },
      "application/hjson": {
        extensions: ["hjson"]
      },
      "application/http": {
        source: "iana"
      },
      "application/hyperstudio": {
        source: "iana",
        extensions: ["stk"]
      },
      "application/ibe-key-request+xml": {
        source: "iana",
        compressible: true
      },
      "application/ibe-pkg-reply+xml": {
        source: "iana",
        compressible: true
      },
      "application/ibe-pp-data": {
        source: "iana"
      },
      "application/iges": {
        source: "iana"
      },
      "application/im-iscomposing+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/index": {
        source: "iana"
      },
      "application/index.cmd": {
        source: "iana"
      },
      "application/index.obj": {
        source: "iana"
      },
      "application/index.response": {
        source: "iana"
      },
      "application/index.vnd": {
        source: "iana"
      },
      "application/inkml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["ink", "inkml"]
      },
      "application/iotp": {
        source: "iana"
      },
      "application/ipfix": {
        source: "iana",
        extensions: ["ipfix"]
      },
      "application/ipp": {
        source: "iana"
      },
      "application/isup": {
        source: "iana"
      },
      "application/its+xml": {
        source: "iana",
        compressible: true,
        extensions: ["its"]
      },
      "application/java-archive": {
        source: "apache",
        compressible: false,
        extensions: ["jar", "war", "ear"]
      },
      "application/java-serialized-object": {
        source: "apache",
        compressible: false,
        extensions: ["ser"]
      },
      "application/java-vm": {
        source: "apache",
        compressible: false,
        extensions: ["class"]
      },
      "application/javascript": {
        source: "iana",
        charset: "UTF-8",
        compressible: true,
        extensions: ["js", "mjs"]
      },
      "application/jf2feed+json": {
        source: "iana",
        compressible: true
      },
      "application/jose": {
        source: "iana"
      },
      "application/jose+json": {
        source: "iana",
        compressible: true
      },
      "application/jrd+json": {
        source: "iana",
        compressible: true
      },
      "application/jscalendar+json": {
        source: "iana",
        compressible: true
      },
      "application/json": {
        source: "iana",
        charset: "UTF-8",
        compressible: true,
        extensions: ["json", "map"]
      },
      "application/json-patch+json": {
        source: "iana",
        compressible: true
      },
      "application/json-seq": {
        source: "iana"
      },
      "application/json5": {
        extensions: ["json5"]
      },
      "application/jsonml+json": {
        source: "apache",
        compressible: true,
        extensions: ["jsonml"]
      },
      "application/jwk+json": {
        source: "iana",
        compressible: true
      },
      "application/jwk-set+json": {
        source: "iana",
        compressible: true
      },
      "application/jwt": {
        source: "iana"
      },
      "application/kpml-request+xml": {
        source: "iana",
        compressible: true
      },
      "application/kpml-response+xml": {
        source: "iana",
        compressible: true
      },
      "application/ld+json": {
        source: "iana",
        compressible: true,
        extensions: ["jsonld"]
      },
      "application/lgr+xml": {
        source: "iana",
        compressible: true,
        extensions: ["lgr"]
      },
      "application/link-format": {
        source: "iana"
      },
      "application/load-control+xml": {
        source: "iana",
        compressible: true
      },
      "application/lost+xml": {
        source: "iana",
        compressible: true,
        extensions: ["lostxml"]
      },
      "application/lostsync+xml": {
        source: "iana",
        compressible: true
      },
      "application/lpf+zip": {
        source: "iana",
        compressible: false
      },
      "application/lxf": {
        source: "iana"
      },
      "application/mac-binhex40": {
        source: "iana",
        extensions: ["hqx"]
      },
      "application/mac-compactpro": {
        source: "apache",
        extensions: ["cpt"]
      },
      "application/macwriteii": {
        source: "iana"
      },
      "application/mads+xml": {
        source: "iana",
        compressible: true,
        extensions: ["mads"]
      },
      "application/manifest+json": {
        source: "iana",
        charset: "UTF-8",
        compressible: true,
        extensions: ["webmanifest"]
      },
      "application/marc": {
        source: "iana",
        extensions: ["mrc"]
      },
      "application/marcxml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["mrcx"]
      },
      "application/mathematica": {
        source: "iana",
        extensions: ["ma", "nb", "mb"]
      },
      "application/mathml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["mathml"]
      },
      "application/mathml-content+xml": {
        source: "iana",
        compressible: true
      },
      "application/mathml-presentation+xml": {
        source: "iana",
        compressible: true
      },
      "application/mbms-associated-procedure-description+xml": {
        source: "iana",
        compressible: true
      },
      "application/mbms-deregister+xml": {
        source: "iana",
        compressible: true
      },
      "application/mbms-envelope+xml": {
        source: "iana",
        compressible: true
      },
      "application/mbms-msk+xml": {
        source: "iana",
        compressible: true
      },
      "application/mbms-msk-response+xml": {
        source: "iana",
        compressible: true
      },
      "application/mbms-protection-description+xml": {
        source: "iana",
        compressible: true
      },
      "application/mbms-reception-report+xml": {
        source: "iana",
        compressible: true
      },
      "application/mbms-register+xml": {
        source: "iana",
        compressible: true
      },
      "application/mbms-register-response+xml": {
        source: "iana",
        compressible: true
      },
      "application/mbms-schedule+xml": {
        source: "iana",
        compressible: true
      },
      "application/mbms-user-service-description+xml": {
        source: "iana",
        compressible: true
      },
      "application/mbox": {
        source: "iana",
        extensions: ["mbox"]
      },
      "application/media-policy-dataset+xml": {
        source: "iana",
        compressible: true,
        extensions: ["mpf"]
      },
      "application/media_control+xml": {
        source: "iana",
        compressible: true
      },
      "application/mediaservercontrol+xml": {
        source: "iana",
        compressible: true,
        extensions: ["mscml"]
      },
      "application/merge-patch+json": {
        source: "iana",
        compressible: true
      },
      "application/metalink+xml": {
        source: "apache",
        compressible: true,
        extensions: ["metalink"]
      },
      "application/metalink4+xml": {
        source: "iana",
        compressible: true,
        extensions: ["meta4"]
      },
      "application/mets+xml": {
        source: "iana",
        compressible: true,
        extensions: ["mets"]
      },
      "application/mf4": {
        source: "iana"
      },
      "application/mikey": {
        source: "iana"
      },
      "application/mipc": {
        source: "iana"
      },
      "application/missing-blocks+cbor-seq": {
        source: "iana"
      },
      "application/mmt-aei+xml": {
        source: "iana",
        compressible: true,
        extensions: ["maei"]
      },
      "application/mmt-usd+xml": {
        source: "iana",
        compressible: true,
        extensions: ["musd"]
      },
      "application/mods+xml": {
        source: "iana",
        compressible: true,
        extensions: ["mods"]
      },
      "application/moss-keys": {
        source: "iana"
      },
      "application/moss-signature": {
        source: "iana"
      },
      "application/mosskey-data": {
        source: "iana"
      },
      "application/mosskey-request": {
        source: "iana"
      },
      "application/mp21": {
        source: "iana",
        extensions: ["m21", "mp21"]
      },
      "application/mp4": {
        source: "iana",
        extensions: ["mp4s", "m4p"]
      },
      "application/mpeg4-generic": {
        source: "iana"
      },
      "application/mpeg4-iod": {
        source: "iana"
      },
      "application/mpeg4-iod-xmt": {
        source: "iana"
      },
      "application/mrb-consumer+xml": {
        source: "iana",
        compressible: true
      },
      "application/mrb-publish+xml": {
        source: "iana",
        compressible: true
      },
      "application/msc-ivr+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/msc-mixer+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/msword": {
        source: "iana",
        compressible: false,
        extensions: ["doc", "dot"]
      },
      "application/mud+json": {
        source: "iana",
        compressible: true
      },
      "application/multipart-core": {
        source: "iana"
      },
      "application/mxf": {
        source: "iana",
        extensions: ["mxf"]
      },
      "application/n-quads": {
        source: "iana",
        extensions: ["nq"]
      },
      "application/n-triples": {
        source: "iana",
        extensions: ["nt"]
      },
      "application/nasdata": {
        source: "iana"
      },
      "application/news-checkgroups": {
        source: "iana",
        charset: "US-ASCII"
      },
      "application/news-groupinfo": {
        source: "iana",
        charset: "US-ASCII"
      },
      "application/news-transmission": {
        source: "iana"
      },
      "application/nlsml+xml": {
        source: "iana",
        compressible: true
      },
      "application/node": {
        source: "iana",
        extensions: ["cjs"]
      },
      "application/nss": {
        source: "iana"
      },
      "application/oauth-authz-req+jwt": {
        source: "iana"
      },
      "application/oblivious-dns-message": {
        source: "iana"
      },
      "application/ocsp-request": {
        source: "iana"
      },
      "application/ocsp-response": {
        source: "iana"
      },
      "application/octet-stream": {
        source: "iana",
        compressible: false,
        extensions: ["bin", "dms", "lrf", "mar", "so", "dist", "distz", "pkg", "bpk", "dump", "elc", "deploy", "exe", "dll", "deb", "dmg", "iso", "img", "msi", "msp", "msm", "buffer"]
      },
      "application/oda": {
        source: "iana",
        extensions: ["oda"]
      },
      "application/odm+xml": {
        source: "iana",
        compressible: true
      },
      "application/odx": {
        source: "iana"
      },
      "application/oebps-package+xml": {
        source: "iana",
        compressible: true,
        extensions: ["opf"]
      },
      "application/ogg": {
        source: "iana",
        compressible: false,
        extensions: ["ogx"]
      },
      "application/omdoc+xml": {
        source: "apache",
        compressible: true,
        extensions: ["omdoc"]
      },
      "application/onenote": {
        source: "apache",
        extensions: ["onetoc", "onetoc2", "onetmp", "onepkg"]
      },
      "application/opc-nodeset+xml": {
        source: "iana",
        compressible: true
      },
      "application/oscore": {
        source: "iana"
      },
      "application/oxps": {
        source: "iana",
        extensions: ["oxps"]
      },
      "application/p21": {
        source: "iana"
      },
      "application/p21+zip": {
        source: "iana",
        compressible: false
      },
      "application/p2p-overlay+xml": {
        source: "iana",
        compressible: true,
        extensions: ["relo"]
      },
      "application/parityfec": {
        source: "iana"
      },
      "application/passport": {
        source: "iana"
      },
      "application/patch-ops-error+xml": {
        source: "iana",
        compressible: true,
        extensions: ["xer"]
      },
      "application/pdf": {
        source: "iana",
        compressible: false,
        extensions: ["pdf"]
      },
      "application/pdx": {
        source: "iana"
      },
      "application/pem-certificate-chain": {
        source: "iana"
      },
      "application/pgp-encrypted": {
        source: "iana",
        compressible: false,
        extensions: ["pgp"]
      },
      "application/pgp-keys": {
        source: "iana",
        extensions: ["asc"]
      },
      "application/pgp-signature": {
        source: "iana",
        extensions: ["asc", "sig"]
      },
      "application/pics-rules": {
        source: "apache",
        extensions: ["prf"]
      },
      "application/pidf+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/pidf-diff+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/pkcs10": {
        source: "iana",
        extensions: ["p10"]
      },
      "application/pkcs12": {
        source: "iana"
      },
      "application/pkcs7-mime": {
        source: "iana",
        extensions: ["p7m", "p7c"]
      },
      "application/pkcs7-signature": {
        source: "iana",
        extensions: ["p7s"]
      },
      "application/pkcs8": {
        source: "iana",
        extensions: ["p8"]
      },
      "application/pkcs8-encrypted": {
        source: "iana"
      },
      "application/pkix-attr-cert": {
        source: "iana",
        extensions: ["ac"]
      },
      "application/pkix-cert": {
        source: "iana",
        extensions: ["cer"]
      },
      "application/pkix-crl": {
        source: "iana",
        extensions: ["crl"]
      },
      "application/pkix-pkipath": {
        source: "iana",
        extensions: ["pkipath"]
      },
      "application/pkixcmp": {
        source: "iana",
        extensions: ["pki"]
      },
      "application/pls+xml": {
        source: "iana",
        compressible: true,
        extensions: ["pls"]
      },
      "application/poc-settings+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/postscript": {
        source: "iana",
        compressible: true,
        extensions: ["ai", "eps", "ps"]
      },
      "application/ppsp-tracker+json": {
        source: "iana",
        compressible: true
      },
      "application/problem+json": {
        source: "iana",
        compressible: true
      },
      "application/problem+xml": {
        source: "iana",
        compressible: true
      },
      "application/provenance+xml": {
        source: "iana",
        compressible: true,
        extensions: ["provx"]
      },
      "application/prs.alvestrand.titrax-sheet": {
        source: "iana"
      },
      "application/prs.cww": {
        source: "iana",
        extensions: ["cww"]
      },
      "application/prs.cyn": {
        source: "iana",
        charset: "7-BIT"
      },
      "application/prs.hpub+zip": {
        source: "iana",
        compressible: false
      },
      "application/prs.nprend": {
        source: "iana"
      },
      "application/prs.plucker": {
        source: "iana"
      },
      "application/prs.rdf-xml-crypt": {
        source: "iana"
      },
      "application/prs.xsf+xml": {
        source: "iana",
        compressible: true
      },
      "application/pskc+xml": {
        source: "iana",
        compressible: true,
        extensions: ["pskcxml"]
      },
      "application/pvd+json": {
        source: "iana",
        compressible: true
      },
      "application/qsig": {
        source: "iana"
      },
      "application/raml+yaml": {
        compressible: true,
        extensions: ["raml"]
      },
      "application/raptorfec": {
        source: "iana"
      },
      "application/rdap+json": {
        source: "iana",
        compressible: true
      },
      "application/rdf+xml": {
        source: "iana",
        compressible: true,
        extensions: ["rdf", "owl"]
      },
      "application/reginfo+xml": {
        source: "iana",
        compressible: true,
        extensions: ["rif"]
      },
      "application/relax-ng-compact-syntax": {
        source: "iana",
        extensions: ["rnc"]
      },
      "application/remote-printing": {
        source: "iana"
      },
      "application/reputon+json": {
        source: "iana",
        compressible: true
      },
      "application/resource-lists+xml": {
        source: "iana",
        compressible: true,
        extensions: ["rl"]
      },
      "application/resource-lists-diff+xml": {
        source: "iana",
        compressible: true,
        extensions: ["rld"]
      },
      "application/rfc+xml": {
        source: "iana",
        compressible: true
      },
      "application/riscos": {
        source: "iana"
      },
      "application/rlmi+xml": {
        source: "iana",
        compressible: true
      },
      "application/rls-services+xml": {
        source: "iana",
        compressible: true,
        extensions: ["rs"]
      },
      "application/route-apd+xml": {
        source: "iana",
        compressible: true,
        extensions: ["rapd"]
      },
      "application/route-s-tsid+xml": {
        source: "iana",
        compressible: true,
        extensions: ["sls"]
      },
      "application/route-usd+xml": {
        source: "iana",
        compressible: true,
        extensions: ["rusd"]
      },
      "application/rpki-ghostbusters": {
        source: "iana",
        extensions: ["gbr"]
      },
      "application/rpki-manifest": {
        source: "iana",
        extensions: ["mft"]
      },
      "application/rpki-publication": {
        source: "iana"
      },
      "application/rpki-roa": {
        source: "iana",
        extensions: ["roa"]
      },
      "application/rpki-updown": {
        source: "iana"
      },
      "application/rsd+xml": {
        source: "apache",
        compressible: true,
        extensions: ["rsd"]
      },
      "application/rss+xml": {
        source: "apache",
        compressible: true,
        extensions: ["rss"]
      },
      "application/rtf": {
        source: "iana",
        compressible: true,
        extensions: ["rtf"]
      },
      "application/rtploopback": {
        source: "iana"
      },
      "application/rtx": {
        source: "iana"
      },
      "application/samlassertion+xml": {
        source: "iana",
        compressible: true
      },
      "application/samlmetadata+xml": {
        source: "iana",
        compressible: true
      },
      "application/sarif+json": {
        source: "iana",
        compressible: true
      },
      "application/sarif-external-properties+json": {
        source: "iana",
        compressible: true
      },
      "application/sbe": {
        source: "iana"
      },
      "application/sbml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["sbml"]
      },
      "application/scaip+xml": {
        source: "iana",
        compressible: true
      },
      "application/scim+json": {
        source: "iana",
        compressible: true
      },
      "application/scvp-cv-request": {
        source: "iana",
        extensions: ["scq"]
      },
      "application/scvp-cv-response": {
        source: "iana",
        extensions: ["scs"]
      },
      "application/scvp-vp-request": {
        source: "iana",
        extensions: ["spq"]
      },
      "application/scvp-vp-response": {
        source: "iana",
        extensions: ["spp"]
      },
      "application/sdp": {
        source: "iana",
        extensions: ["sdp"]
      },
      "application/secevent+jwt": {
        source: "iana"
      },
      "application/senml+cbor": {
        source: "iana"
      },
      "application/senml+json": {
        source: "iana",
        compressible: true
      },
      "application/senml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["senmlx"]
      },
      "application/senml-etch+cbor": {
        source: "iana"
      },
      "application/senml-etch+json": {
        source: "iana",
        compressible: true
      },
      "application/senml-exi": {
        source: "iana"
      },
      "application/sensml+cbor": {
        source: "iana"
      },
      "application/sensml+json": {
        source: "iana",
        compressible: true
      },
      "application/sensml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["sensmlx"]
      },
      "application/sensml-exi": {
        source: "iana"
      },
      "application/sep+xml": {
        source: "iana",
        compressible: true
      },
      "application/sep-exi": {
        source: "iana"
      },
      "application/session-info": {
        source: "iana"
      },
      "application/set-payment": {
        source: "iana"
      },
      "application/set-payment-initiation": {
        source: "iana",
        extensions: ["setpay"]
      },
      "application/set-registration": {
        source: "iana"
      },
      "application/set-registration-initiation": {
        source: "iana",
        extensions: ["setreg"]
      },
      "application/sgml": {
        source: "iana"
      },
      "application/sgml-open-catalog": {
        source: "iana"
      },
      "application/shf+xml": {
        source: "iana",
        compressible: true,
        extensions: ["shf"]
      },
      "application/sieve": {
        source: "iana",
        extensions: ["siv", "sieve"]
      },
      "application/simple-filter+xml": {
        source: "iana",
        compressible: true
      },
      "application/simple-message-summary": {
        source: "iana"
      },
      "application/simplesymbolcontainer": {
        source: "iana"
      },
      "application/sipc": {
        source: "iana"
      },
      "application/slate": {
        source: "iana"
      },
      "application/smil": {
        source: "iana"
      },
      "application/smil+xml": {
        source: "iana",
        compressible: true,
        extensions: ["smi", "smil"]
      },
      "application/smpte336m": {
        source: "iana"
      },
      "application/soap+fastinfoset": {
        source: "iana"
      },
      "application/soap+xml": {
        source: "iana",
        compressible: true
      },
      "application/sparql-query": {
        source: "iana",
        extensions: ["rq"]
      },
      "application/sparql-results+xml": {
        source: "iana",
        compressible: true,
        extensions: ["srx"]
      },
      "application/spdx+json": {
        source: "iana",
        compressible: true
      },
      "application/spirits-event+xml": {
        source: "iana",
        compressible: true
      },
      "application/sql": {
        source: "iana"
      },
      "application/srgs": {
        source: "iana",
        extensions: ["gram"]
      },
      "application/srgs+xml": {
        source: "iana",
        compressible: true,
        extensions: ["grxml"]
      },
      "application/sru+xml": {
        source: "iana",
        compressible: true,
        extensions: ["sru"]
      },
      "application/ssdl+xml": {
        source: "apache",
        compressible: true,
        extensions: ["ssdl"]
      },
      "application/ssml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["ssml"]
      },
      "application/stix+json": {
        source: "iana",
        compressible: true
      },
      "application/swid+xml": {
        source: "iana",
        compressible: true,
        extensions: ["swidtag"]
      },
      "application/tamp-apex-update": {
        source: "iana"
      },
      "application/tamp-apex-update-confirm": {
        source: "iana"
      },
      "application/tamp-community-update": {
        source: "iana"
      },
      "application/tamp-community-update-confirm": {
        source: "iana"
      },
      "application/tamp-error": {
        source: "iana"
      },
      "application/tamp-sequence-adjust": {
        source: "iana"
      },
      "application/tamp-sequence-adjust-confirm": {
        source: "iana"
      },
      "application/tamp-status-query": {
        source: "iana"
      },
      "application/tamp-status-response": {
        source: "iana"
      },
      "application/tamp-update": {
        source: "iana"
      },
      "application/tamp-update-confirm": {
        source: "iana"
      },
      "application/tar": {
        compressible: true
      },
      "application/taxii+json": {
        source: "iana",
        compressible: true
      },
      "application/td+json": {
        source: "iana",
        compressible: true
      },
      "application/tei+xml": {
        source: "iana",
        compressible: true,
        extensions: ["tei", "teicorpus"]
      },
      "application/tetra_isi": {
        source: "iana"
      },
      "application/thraud+xml": {
        source: "iana",
        compressible: true,
        extensions: ["tfi"]
      },
      "application/timestamp-query": {
        source: "iana"
      },
      "application/timestamp-reply": {
        source: "iana"
      },
      "application/timestamped-data": {
        source: "iana",
        extensions: ["tsd"]
      },
      "application/tlsrpt+gzip": {
        source: "iana"
      },
      "application/tlsrpt+json": {
        source: "iana",
        compressible: true
      },
      "application/tnauthlist": {
        source: "iana"
      },
      "application/token-introspection+jwt": {
        source: "iana"
      },
      "application/toml": {
        compressible: true,
        extensions: ["toml"]
      },
      "application/trickle-ice-sdpfrag": {
        source: "iana"
      },
      "application/trig": {
        source: "iana",
        extensions: ["trig"]
      },
      "application/ttml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["ttml"]
      },
      "application/tve-trigger": {
        source: "iana"
      },
      "application/tzif": {
        source: "iana"
      },
      "application/tzif-leap": {
        source: "iana"
      },
      "application/ubjson": {
        compressible: false,
        extensions: ["ubj"]
      },
      "application/ulpfec": {
        source: "iana"
      },
      "application/urc-grpsheet+xml": {
        source: "iana",
        compressible: true
      },
      "application/urc-ressheet+xml": {
        source: "iana",
        compressible: true,
        extensions: ["rsheet"]
      },
      "application/urc-targetdesc+xml": {
        source: "iana",
        compressible: true,
        extensions: ["td"]
      },
      "application/urc-uisocketdesc+xml": {
        source: "iana",
        compressible: true
      },
      "application/vcard+json": {
        source: "iana",
        compressible: true
      },
      "application/vcard+xml": {
        source: "iana",
        compressible: true
      },
      "application/vemmi": {
        source: "iana"
      },
      "application/vividence.scriptfile": {
        source: "apache"
      },
      "application/vnd.1000minds.decision-model+xml": {
        source: "iana",
        compressible: true,
        extensions: ["1km"]
      },
      "application/vnd.3gpp-prose+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp-prose-pc3ch+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp-v2x-local-service-information": {
        source: "iana"
      },
      "application/vnd.3gpp.5gnas": {
        source: "iana"
      },
      "application/vnd.3gpp.access-transfer-events+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.bsf+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.gmop+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.gtpc": {
        source: "iana"
      },
      "application/vnd.3gpp.interworking-data": {
        source: "iana"
      },
      "application/vnd.3gpp.lpp": {
        source: "iana"
      },
      "application/vnd.3gpp.mc-signalling-ear": {
        source: "iana"
      },
      "application/vnd.3gpp.mcdata-affiliation-command+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcdata-info+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcdata-payload": {
        source: "iana"
      },
      "application/vnd.3gpp.mcdata-service-config+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcdata-signalling": {
        source: "iana"
      },
      "application/vnd.3gpp.mcdata-ue-config+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcdata-user-profile+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcptt-affiliation-command+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcptt-floor-request+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcptt-info+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcptt-location-info+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcptt-mbms-usage-info+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcptt-service-config+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcptt-signed+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcptt-ue-config+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcptt-ue-init-config+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcptt-user-profile+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcvideo-affiliation-command+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcvideo-affiliation-info+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcvideo-info+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcvideo-location-info+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcvideo-mbms-usage-info+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcvideo-service-config+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcvideo-transmission-request+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcvideo-ue-config+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mcvideo-user-profile+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.mid-call+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.ngap": {
        source: "iana"
      },
      "application/vnd.3gpp.pfcp": {
        source: "iana"
      },
      "application/vnd.3gpp.pic-bw-large": {
        source: "iana",
        extensions: ["plb"]
      },
      "application/vnd.3gpp.pic-bw-small": {
        source: "iana",
        extensions: ["psb"]
      },
      "application/vnd.3gpp.pic-bw-var": {
        source: "iana",
        extensions: ["pvb"]
      },
      "application/vnd.3gpp.s1ap": {
        source: "iana"
      },
      "application/vnd.3gpp.sms": {
        source: "iana"
      },
      "application/vnd.3gpp.sms+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.srvcc-ext+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.srvcc-info+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.state-and-event-info+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp.ussd+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp2.bcmcsinfo+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.3gpp2.sms": {
        source: "iana"
      },
      "application/vnd.3gpp2.tcap": {
        source: "iana",
        extensions: ["tcap"]
      },
      "application/vnd.3lightssoftware.imagescal": {
        source: "iana"
      },
      "application/vnd.3m.post-it-notes": {
        source: "iana",
        extensions: ["pwn"]
      },
      "application/vnd.accpac.simply.aso": {
        source: "iana",
        extensions: ["aso"]
      },
      "application/vnd.accpac.simply.imp": {
        source: "iana",
        extensions: ["imp"]
      },
      "application/vnd.acucobol": {
        source: "iana",
        extensions: ["acu"]
      },
      "application/vnd.acucorp": {
        source: "iana",
        extensions: ["atc", "acutc"]
      },
      "application/vnd.adobe.air-application-installer-package+zip": {
        source: "apache",
        compressible: false,
        extensions: ["air"]
      },
      "application/vnd.adobe.flash.movie": {
        source: "iana"
      },
      "application/vnd.adobe.formscentral.fcdt": {
        source: "iana",
        extensions: ["fcdt"]
      },
      "application/vnd.adobe.fxp": {
        source: "iana",
        extensions: ["fxp", "fxpl"]
      },
      "application/vnd.adobe.partial-upload": {
        source: "iana"
      },
      "application/vnd.adobe.xdp+xml": {
        source: "iana",
        compressible: true,
        extensions: ["xdp"]
      },
      "application/vnd.adobe.xfdf": {
        source: "iana",
        extensions: ["xfdf"]
      },
      "application/vnd.aether.imp": {
        source: "iana"
      },
      "application/vnd.afpc.afplinedata": {
        source: "iana"
      },
      "application/vnd.afpc.afplinedata-pagedef": {
        source: "iana"
      },
      "application/vnd.afpc.cmoca-cmresource": {
        source: "iana"
      },
      "application/vnd.afpc.foca-charset": {
        source: "iana"
      },
      "application/vnd.afpc.foca-codedfont": {
        source: "iana"
      },
      "application/vnd.afpc.foca-codepage": {
        source: "iana"
      },
      "application/vnd.afpc.modca": {
        source: "iana"
      },
      "application/vnd.afpc.modca-cmtable": {
        source: "iana"
      },
      "application/vnd.afpc.modca-formdef": {
        source: "iana"
      },
      "application/vnd.afpc.modca-mediummap": {
        source: "iana"
      },
      "application/vnd.afpc.modca-objectcontainer": {
        source: "iana"
      },
      "application/vnd.afpc.modca-overlay": {
        source: "iana"
      },
      "application/vnd.afpc.modca-pagesegment": {
        source: "iana"
      },
      "application/vnd.age": {
        source: "iana",
        extensions: ["age"]
      },
      "application/vnd.ah-barcode": {
        source: "iana"
      },
      "application/vnd.ahead.space": {
        source: "iana",
        extensions: ["ahead"]
      },
      "application/vnd.airzip.filesecure.azf": {
        source: "iana",
        extensions: ["azf"]
      },
      "application/vnd.airzip.filesecure.azs": {
        source: "iana",
        extensions: ["azs"]
      },
      "application/vnd.amadeus+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.amazon.ebook": {
        source: "apache",
        extensions: ["azw"]
      },
      "application/vnd.amazon.mobi8-ebook": {
        source: "iana"
      },
      "application/vnd.americandynamics.acc": {
        source: "iana",
        extensions: ["acc"]
      },
      "application/vnd.amiga.ami": {
        source: "iana",
        extensions: ["ami"]
      },
      "application/vnd.amundsen.maze+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.android.ota": {
        source: "iana"
      },
      "application/vnd.android.package-archive": {
        source: "apache",
        compressible: false,
        extensions: ["apk"]
      },
      "application/vnd.anki": {
        source: "iana"
      },
      "application/vnd.anser-web-certificate-issue-initiation": {
        source: "iana",
        extensions: ["cii"]
      },
      "application/vnd.anser-web-funds-transfer-initiation": {
        source: "apache",
        extensions: ["fti"]
      },
      "application/vnd.antix.game-component": {
        source: "iana",
        extensions: ["atx"]
      },
      "application/vnd.apache.arrow.file": {
        source: "iana"
      },
      "application/vnd.apache.arrow.stream": {
        source: "iana"
      },
      "application/vnd.apache.thrift.binary": {
        source: "iana"
      },
      "application/vnd.apache.thrift.compact": {
        source: "iana"
      },
      "application/vnd.apache.thrift.json": {
        source: "iana"
      },
      "application/vnd.api+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.aplextor.warrp+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.apothekende.reservation+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.apple.installer+xml": {
        source: "iana",
        compressible: true,
        extensions: ["mpkg"]
      },
      "application/vnd.apple.keynote": {
        source: "iana",
        extensions: ["key"]
      },
      "application/vnd.apple.mpegurl": {
        source: "iana",
        extensions: ["m3u8"]
      },
      "application/vnd.apple.numbers": {
        source: "iana",
        extensions: ["numbers"]
      },
      "application/vnd.apple.pages": {
        source: "iana",
        extensions: ["pages"]
      },
      "application/vnd.apple.pkpass": {
        compressible: false,
        extensions: ["pkpass"]
      },
      "application/vnd.arastra.swi": {
        source: "iana"
      },
      "application/vnd.aristanetworks.swi": {
        source: "iana",
        extensions: ["swi"]
      },
      "application/vnd.artisan+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.artsquare": {
        source: "iana"
      },
      "application/vnd.astraea-software.iota": {
        source: "iana",
        extensions: ["iota"]
      },
      "application/vnd.audiograph": {
        source: "iana",
        extensions: ["aep"]
      },
      "application/vnd.autopackage": {
        source: "iana"
      },
      "application/vnd.avalon+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.avistar+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.balsamiq.bmml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["bmml"]
      },
      "application/vnd.balsamiq.bmpr": {
        source: "iana"
      },
      "application/vnd.banana-accounting": {
        source: "iana"
      },
      "application/vnd.bbf.usp.error": {
        source: "iana"
      },
      "application/vnd.bbf.usp.msg": {
        source: "iana"
      },
      "application/vnd.bbf.usp.msg+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.bekitzur-stech+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.bint.med-content": {
        source: "iana"
      },
      "application/vnd.biopax.rdf+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.blink-idb-value-wrapper": {
        source: "iana"
      },
      "application/vnd.blueice.multipass": {
        source: "iana",
        extensions: ["mpm"]
      },
      "application/vnd.bluetooth.ep.oob": {
        source: "iana"
      },
      "application/vnd.bluetooth.le.oob": {
        source: "iana"
      },
      "application/vnd.bmi": {
        source: "iana",
        extensions: ["bmi"]
      },
      "application/vnd.bpf": {
        source: "iana"
      },
      "application/vnd.bpf3": {
        source: "iana"
      },
      "application/vnd.businessobjects": {
        source: "iana",
        extensions: ["rep"]
      },
      "application/vnd.byu.uapi+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.cab-jscript": {
        source: "iana"
      },
      "application/vnd.canon-cpdl": {
        source: "iana"
      },
      "application/vnd.canon-lips": {
        source: "iana"
      },
      "application/vnd.capasystems-pg+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.cendio.thinlinc.clientconf": {
        source: "iana"
      },
      "application/vnd.century-systems.tcp_stream": {
        source: "iana"
      },
      "application/vnd.chemdraw+xml": {
        source: "iana",
        compressible: true,
        extensions: ["cdxml"]
      },
      "application/vnd.chess-pgn": {
        source: "iana"
      },
      "application/vnd.chipnuts.karaoke-mmd": {
        source: "iana",
        extensions: ["mmd"]
      },
      "application/vnd.ciedi": {
        source: "iana"
      },
      "application/vnd.cinderella": {
        source: "iana",
        extensions: ["cdy"]
      },
      "application/vnd.cirpack.isdn-ext": {
        source: "iana"
      },
      "application/vnd.citationstyles.style+xml": {
        source: "iana",
        compressible: true,
        extensions: ["csl"]
      },
      "application/vnd.claymore": {
        source: "iana",
        extensions: ["cla"]
      },
      "application/vnd.cloanto.rp9": {
        source: "iana",
        extensions: ["rp9"]
      },
      "application/vnd.clonk.c4group": {
        source: "iana",
        extensions: ["c4g", "c4d", "c4f", "c4p", "c4u"]
      },
      "application/vnd.cluetrust.cartomobile-config": {
        source: "iana",
        extensions: ["c11amc"]
      },
      "application/vnd.cluetrust.cartomobile-config-pkg": {
        source: "iana",
        extensions: ["c11amz"]
      },
      "application/vnd.coffeescript": {
        source: "iana"
      },
      "application/vnd.collabio.xodocuments.document": {
        source: "iana"
      },
      "application/vnd.collabio.xodocuments.document-template": {
        source: "iana"
      },
      "application/vnd.collabio.xodocuments.presentation": {
        source: "iana"
      },
      "application/vnd.collabio.xodocuments.presentation-template": {
        source: "iana"
      },
      "application/vnd.collabio.xodocuments.spreadsheet": {
        source: "iana"
      },
      "application/vnd.collabio.xodocuments.spreadsheet-template": {
        source: "iana"
      },
      "application/vnd.collection+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.collection.doc+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.collection.next+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.comicbook+zip": {
        source: "iana",
        compressible: false
      },
      "application/vnd.comicbook-rar": {
        source: "iana"
      },
      "application/vnd.commerce-battelle": {
        source: "iana"
      },
      "application/vnd.commonspace": {
        source: "iana",
        extensions: ["csp"]
      },
      "application/vnd.contact.cmsg": {
        source: "iana",
        extensions: ["cdbcmsg"]
      },
      "application/vnd.coreos.ignition+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.cosmocaller": {
        source: "iana",
        extensions: ["cmc"]
      },
      "application/vnd.crick.clicker": {
        source: "iana",
        extensions: ["clkx"]
      },
      "application/vnd.crick.clicker.keyboard": {
        source: "iana",
        extensions: ["clkk"]
      },
      "application/vnd.crick.clicker.palette": {
        source: "iana",
        extensions: ["clkp"]
      },
      "application/vnd.crick.clicker.template": {
        source: "iana",
        extensions: ["clkt"]
      },
      "application/vnd.crick.clicker.wordbank": {
        source: "iana",
        extensions: ["clkw"]
      },
      "application/vnd.criticaltools.wbs+xml": {
        source: "iana",
        compressible: true,
        extensions: ["wbs"]
      },
      "application/vnd.cryptii.pipe+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.crypto-shade-file": {
        source: "iana"
      },
      "application/vnd.cryptomator.encrypted": {
        source: "iana"
      },
      "application/vnd.cryptomator.vault": {
        source: "iana"
      },
      "application/vnd.ctc-posml": {
        source: "iana",
        extensions: ["pml"]
      },
      "application/vnd.ctct.ws+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.cups-pdf": {
        source: "iana"
      },
      "application/vnd.cups-postscript": {
        source: "iana"
      },
      "application/vnd.cups-ppd": {
        source: "iana",
        extensions: ["ppd"]
      },
      "application/vnd.cups-raster": {
        source: "iana"
      },
      "application/vnd.cups-raw": {
        source: "iana"
      },
      "application/vnd.curl": {
        source: "iana"
      },
      "application/vnd.curl.car": {
        source: "apache",
        extensions: ["car"]
      },
      "application/vnd.curl.pcurl": {
        source: "apache",
        extensions: ["pcurl"]
      },
      "application/vnd.cyan.dean.root+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.cybank": {
        source: "iana"
      },
      "application/vnd.cyclonedx+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.cyclonedx+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.d2l.coursepackage1p0+zip": {
        source: "iana",
        compressible: false
      },
      "application/vnd.d3m-dataset": {
        source: "iana"
      },
      "application/vnd.d3m-problem": {
        source: "iana"
      },
      "application/vnd.dart": {
        source: "iana",
        compressible: true,
        extensions: ["dart"]
      },
      "application/vnd.data-vision.rdz": {
        source: "iana",
        extensions: ["rdz"]
      },
      "application/vnd.datapackage+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.dataresource+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.dbf": {
        source: "iana",
        extensions: ["dbf"]
      },
      "application/vnd.debian.binary-package": {
        source: "iana"
      },
      "application/vnd.dece.data": {
        source: "iana",
        extensions: ["uvf", "uvvf", "uvd", "uvvd"]
      },
      "application/vnd.dece.ttml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["uvt", "uvvt"]
      },
      "application/vnd.dece.unspecified": {
        source: "iana",
        extensions: ["uvx", "uvvx"]
      },
      "application/vnd.dece.zip": {
        source: "iana",
        extensions: ["uvz", "uvvz"]
      },
      "application/vnd.denovo.fcselayout-link": {
        source: "iana",
        extensions: ["fe_launch"]
      },
      "application/vnd.desmume.movie": {
        source: "iana"
      },
      "application/vnd.dir-bi.plate-dl-nosuffix": {
        source: "iana"
      },
      "application/vnd.dm.delegation+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.dna": {
        source: "iana",
        extensions: ["dna"]
      },
      "application/vnd.document+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.dolby.mlp": {
        source: "apache",
        extensions: ["mlp"]
      },
      "application/vnd.dolby.mobile.1": {
        source: "iana"
      },
      "application/vnd.dolby.mobile.2": {
        source: "iana"
      },
      "application/vnd.doremir.scorecloud-binary-document": {
        source: "iana"
      },
      "application/vnd.dpgraph": {
        source: "iana",
        extensions: ["dpg"]
      },
      "application/vnd.dreamfactory": {
        source: "iana",
        extensions: ["dfac"]
      },
      "application/vnd.drive+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.ds-keypoint": {
        source: "apache",
        extensions: ["kpxx"]
      },
      "application/vnd.dtg.local": {
        source: "iana"
      },
      "application/vnd.dtg.local.flash": {
        source: "iana"
      },
      "application/vnd.dtg.local.html": {
        source: "iana"
      },
      "application/vnd.dvb.ait": {
        source: "iana",
        extensions: ["ait"]
      },
      "application/vnd.dvb.dvbisl+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.dvb.dvbj": {
        source: "iana"
      },
      "application/vnd.dvb.esgcontainer": {
        source: "iana"
      },
      "application/vnd.dvb.ipdcdftnotifaccess": {
        source: "iana"
      },
      "application/vnd.dvb.ipdcesgaccess": {
        source: "iana"
      },
      "application/vnd.dvb.ipdcesgaccess2": {
        source: "iana"
      },
      "application/vnd.dvb.ipdcesgpdd": {
        source: "iana"
      },
      "application/vnd.dvb.ipdcroaming": {
        source: "iana"
      },
      "application/vnd.dvb.iptv.alfec-base": {
        source: "iana"
      },
      "application/vnd.dvb.iptv.alfec-enhancement": {
        source: "iana"
      },
      "application/vnd.dvb.notif-aggregate-root+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.dvb.notif-container+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.dvb.notif-generic+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.dvb.notif-ia-msglist+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.dvb.notif-ia-registration-request+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.dvb.notif-ia-registration-response+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.dvb.notif-init+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.dvb.pfr": {
        source: "iana"
      },
      "application/vnd.dvb.service": {
        source: "iana",
        extensions: ["svc"]
      },
      "application/vnd.dxr": {
        source: "iana"
      },
      "application/vnd.dynageo": {
        source: "iana",
        extensions: ["geo"]
      },
      "application/vnd.dzr": {
        source: "iana"
      },
      "application/vnd.easykaraoke.cdgdownload": {
        source: "iana"
      },
      "application/vnd.ecdis-update": {
        source: "iana"
      },
      "application/vnd.ecip.rlp": {
        source: "iana"
      },
      "application/vnd.eclipse.ditto+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.ecowin.chart": {
        source: "iana",
        extensions: ["mag"]
      },
      "application/vnd.ecowin.filerequest": {
        source: "iana"
      },
      "application/vnd.ecowin.fileupdate": {
        source: "iana"
      },
      "application/vnd.ecowin.series": {
        source: "iana"
      },
      "application/vnd.ecowin.seriesrequest": {
        source: "iana"
      },
      "application/vnd.ecowin.seriesupdate": {
        source: "iana"
      },
      "application/vnd.efi.img": {
        source: "iana"
      },
      "application/vnd.efi.iso": {
        source: "iana"
      },
      "application/vnd.emclient.accessrequest+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.enliven": {
        source: "iana",
        extensions: ["nml"]
      },
      "application/vnd.enphase.envoy": {
        source: "iana"
      },
      "application/vnd.eprints.data+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.epson.esf": {
        source: "iana",
        extensions: ["esf"]
      },
      "application/vnd.epson.msf": {
        source: "iana",
        extensions: ["msf"]
      },
      "application/vnd.epson.quickanime": {
        source: "iana",
        extensions: ["qam"]
      },
      "application/vnd.epson.salt": {
        source: "iana",
        extensions: ["slt"]
      },
      "application/vnd.epson.ssf": {
        source: "iana",
        extensions: ["ssf"]
      },
      "application/vnd.ericsson.quickcall": {
        source: "iana"
      },
      "application/vnd.espass-espass+zip": {
        source: "iana",
        compressible: false
      },
      "application/vnd.eszigno3+xml": {
        source: "iana",
        compressible: true,
        extensions: ["es3", "et3"]
      },
      "application/vnd.etsi.aoc+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.asic-e+zip": {
        source: "iana",
        compressible: false
      },
      "application/vnd.etsi.asic-s+zip": {
        source: "iana",
        compressible: false
      },
      "application/vnd.etsi.cug+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.iptvcommand+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.iptvdiscovery+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.iptvprofile+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.iptvsad-bc+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.iptvsad-cod+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.iptvsad-npvr+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.iptvservice+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.iptvsync+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.iptvueprofile+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.mcid+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.mheg5": {
        source: "iana"
      },
      "application/vnd.etsi.overload-control-policy-dataset+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.pstn+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.sci+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.simservs+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.timestamp-token": {
        source: "iana"
      },
      "application/vnd.etsi.tsl+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.etsi.tsl.der": {
        source: "iana"
      },
      "application/vnd.eu.kasparian.car+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.eudora.data": {
        source: "iana"
      },
      "application/vnd.evolv.ecig.profile": {
        source: "iana"
      },
      "application/vnd.evolv.ecig.settings": {
        source: "iana"
      },
      "application/vnd.evolv.ecig.theme": {
        source: "iana"
      },
      "application/vnd.exstream-empower+zip": {
        source: "iana",
        compressible: false
      },
      "application/vnd.exstream-package": {
        source: "iana"
      },
      "application/vnd.ezpix-album": {
        source: "iana",
        extensions: ["ez2"]
      },
      "application/vnd.ezpix-package": {
        source: "iana",
        extensions: ["ez3"]
      },
      "application/vnd.f-secure.mobile": {
        source: "iana"
      },
      "application/vnd.familysearch.gedcom+zip": {
        source: "iana",
        compressible: false
      },
      "application/vnd.fastcopy-disk-image": {
        source: "iana"
      },
      "application/vnd.fdf": {
        source: "iana",
        extensions: ["fdf"]
      },
      "application/vnd.fdsn.mseed": {
        source: "iana",
        extensions: ["mseed"]
      },
      "application/vnd.fdsn.seed": {
        source: "iana",
        extensions: ["seed", "dataless"]
      },
      "application/vnd.ffsns": {
        source: "iana"
      },
      "application/vnd.ficlab.flb+zip": {
        source: "iana",
        compressible: false
      },
      "application/vnd.filmit.zfc": {
        source: "iana"
      },
      "application/vnd.fints": {
        source: "iana"
      },
      "application/vnd.firemonkeys.cloudcell": {
        source: "iana"
      },
      "application/vnd.flographit": {
        source: "iana",
        extensions: ["gph"]
      },
      "application/vnd.fluxtime.clip": {
        source: "iana",
        extensions: ["ftc"]
      },
      "application/vnd.font-fontforge-sfd": {
        source: "iana"
      },
      "application/vnd.framemaker": {
        source: "iana",
        extensions: ["fm", "frame", "maker", "book"]
      },
      "application/vnd.frogans.fnc": {
        source: "iana",
        extensions: ["fnc"]
      },
      "application/vnd.frogans.ltf": {
        source: "iana",
        extensions: ["ltf"]
      },
      "application/vnd.fsc.weblaunch": {
        source: "iana",
        extensions: ["fsc"]
      },
      "application/vnd.fujifilm.fb.docuworks": {
        source: "iana"
      },
      "application/vnd.fujifilm.fb.docuworks.binder": {
        source: "iana"
      },
      "application/vnd.fujifilm.fb.docuworks.container": {
        source: "iana"
      },
      "application/vnd.fujifilm.fb.jfi+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.fujitsu.oasys": {
        source: "iana",
        extensions: ["oas"]
      },
      "application/vnd.fujitsu.oasys2": {
        source: "iana",
        extensions: ["oa2"]
      },
      "application/vnd.fujitsu.oasys3": {
        source: "iana",
        extensions: ["oa3"]
      },
      "application/vnd.fujitsu.oasysgp": {
        source: "iana",
        extensions: ["fg5"]
      },
      "application/vnd.fujitsu.oasysprs": {
        source: "iana",
        extensions: ["bh2"]
      },
      "application/vnd.fujixerox.art-ex": {
        source: "iana"
      },
      "application/vnd.fujixerox.art4": {
        source: "iana"
      },
      "application/vnd.fujixerox.ddd": {
        source: "iana",
        extensions: ["ddd"]
      },
      "application/vnd.fujixerox.docuworks": {
        source: "iana",
        extensions: ["xdw"]
      },
      "application/vnd.fujixerox.docuworks.binder": {
        source: "iana",
        extensions: ["xbd"]
      },
      "application/vnd.fujixerox.docuworks.container": {
        source: "iana"
      },
      "application/vnd.fujixerox.hbpl": {
        source: "iana"
      },
      "application/vnd.fut-misnet": {
        source: "iana"
      },
      "application/vnd.futoin+cbor": {
        source: "iana"
      },
      "application/vnd.futoin+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.fuzzysheet": {
        source: "iana",
        extensions: ["fzs"]
      },
      "application/vnd.genomatix.tuxedo": {
        source: "iana",
        extensions: ["txd"]
      },
      "application/vnd.gentics.grd+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.geo+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.geocube+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.geogebra.file": {
        source: "iana",
        extensions: ["ggb"]
      },
      "application/vnd.geogebra.slides": {
        source: "iana"
      },
      "application/vnd.geogebra.tool": {
        source: "iana",
        extensions: ["ggt"]
      },
      "application/vnd.geometry-explorer": {
        source: "iana",
        extensions: ["gex", "gre"]
      },
      "application/vnd.geonext": {
        source: "iana",
        extensions: ["gxt"]
      },
      "application/vnd.geoplan": {
        source: "iana",
        extensions: ["g2w"]
      },
      "application/vnd.geospace": {
        source: "iana",
        extensions: ["g3w"]
      },
      "application/vnd.gerber": {
        source: "iana"
      },
      "application/vnd.globalplatform.card-content-mgt": {
        source: "iana"
      },
      "application/vnd.globalplatform.card-content-mgt-response": {
        source: "iana"
      },
      "application/vnd.gmx": {
        source: "iana",
        extensions: ["gmx"]
      },
      "application/vnd.google-apps.document": {
        compressible: false,
        extensions: ["gdoc"]
      },
      "application/vnd.google-apps.presentation": {
        compressible: false,
        extensions: ["gslides"]
      },
      "application/vnd.google-apps.spreadsheet": {
        compressible: false,
        extensions: ["gsheet"]
      },
      "application/vnd.google-earth.kml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["kml"]
      },
      "application/vnd.google-earth.kmz": {
        source: "iana",
        compressible: false,
        extensions: ["kmz"]
      },
      "application/vnd.gov.sk.e-form+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.gov.sk.e-form+zip": {
        source: "iana",
        compressible: false
      },
      "application/vnd.gov.sk.xmldatacontainer+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.grafeq": {
        source: "iana",
        extensions: ["gqf", "gqs"]
      },
      "application/vnd.gridmp": {
        source: "iana"
      },
      "application/vnd.groove-account": {
        source: "iana",
        extensions: ["gac"]
      },
      "application/vnd.groove-help": {
        source: "iana",
        extensions: ["ghf"]
      },
      "application/vnd.groove-identity-message": {
        source: "iana",
        extensions: ["gim"]
      },
      "application/vnd.groove-injector": {
        source: "iana",
        extensions: ["grv"]
      },
      "application/vnd.groove-tool-message": {
        source: "iana",
        extensions: ["gtm"]
      },
      "application/vnd.groove-tool-template": {
        source: "iana",
        extensions: ["tpl"]
      },
      "application/vnd.groove-vcard": {
        source: "iana",
        extensions: ["vcg"]
      },
      "application/vnd.hal+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.hal+xml": {
        source: "iana",
        compressible: true,
        extensions: ["hal"]
      },
      "application/vnd.handheld-entertainment+xml": {
        source: "iana",
        compressible: true,
        extensions: ["zmm"]
      },
      "application/vnd.hbci": {
        source: "iana",
        extensions: ["hbci"]
      },
      "application/vnd.hc+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.hcl-bireports": {
        source: "iana"
      },
      "application/vnd.hdt": {
        source: "iana"
      },
      "application/vnd.heroku+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.hhe.lesson-player": {
        source: "iana",
        extensions: ["les"]
      },
      "application/vnd.hl7cda+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/vnd.hl7v2+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/vnd.hp-hpgl": {
        source: "iana",
        extensions: ["hpgl"]
      },
      "application/vnd.hp-hpid": {
        source: "iana",
        extensions: ["hpid"]
      },
      "application/vnd.hp-hps": {
        source: "iana",
        extensions: ["hps"]
      },
      "application/vnd.hp-jlyt": {
        source: "iana",
        extensions: ["jlt"]
      },
      "application/vnd.hp-pcl": {
        source: "iana",
        extensions: ["pcl"]
      },
      "application/vnd.hp-pclxl": {
        source: "iana",
        extensions: ["pclxl"]
      },
      "application/vnd.httphone": {
        source: "iana"
      },
      "application/vnd.hydrostatix.sof-data": {
        source: "iana",
        extensions: ["sfd-hdstx"]
      },
      "application/vnd.hyper+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.hyper-item+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.hyperdrive+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.hzn-3d-crossword": {
        source: "iana"
      },
      "application/vnd.ibm.afplinedata": {
        source: "iana"
      },
      "application/vnd.ibm.electronic-media": {
        source: "iana"
      },
      "application/vnd.ibm.minipay": {
        source: "iana",
        extensions: ["mpy"]
      },
      "application/vnd.ibm.modcap": {
        source: "iana",
        extensions: ["afp", "listafp", "list3820"]
      },
      "application/vnd.ibm.rights-management": {
        source: "iana",
        extensions: ["irm"]
      },
      "application/vnd.ibm.secure-container": {
        source: "iana",
        extensions: ["sc"]
      },
      "application/vnd.iccprofile": {
        source: "iana",
        extensions: ["icc", "icm"]
      },
      "application/vnd.ieee.1905": {
        source: "iana"
      },
      "application/vnd.igloader": {
        source: "iana",
        extensions: ["igl"]
      },
      "application/vnd.imagemeter.folder+zip": {
        source: "iana",
        compressible: false
      },
      "application/vnd.imagemeter.image+zip": {
        source: "iana",
        compressible: false
      },
      "application/vnd.immervision-ivp": {
        source: "iana",
        extensions: ["ivp"]
      },
      "application/vnd.immervision-ivu": {
        source: "iana",
        extensions: ["ivu"]
      },
      "application/vnd.ims.imsccv1p1": {
        source: "iana"
      },
      "application/vnd.ims.imsccv1p2": {
        source: "iana"
      },
      "application/vnd.ims.imsccv1p3": {
        source: "iana"
      },
      "application/vnd.ims.lis.v2.result+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.ims.lti.v2.toolconsumerprofile+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.ims.lti.v2.toolproxy+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.ims.lti.v2.toolproxy.id+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.ims.lti.v2.toolsettings+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.ims.lti.v2.toolsettings.simple+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.informedcontrol.rms+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.informix-visionary": {
        source: "iana"
      },
      "application/vnd.infotech.project": {
        source: "iana"
      },
      "application/vnd.infotech.project+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.innopath.wamp.notification": {
        source: "iana"
      },
      "application/vnd.insors.igm": {
        source: "iana",
        extensions: ["igm"]
      },
      "application/vnd.intercon.formnet": {
        source: "iana",
        extensions: ["xpw", "xpx"]
      },
      "application/vnd.intergeo": {
        source: "iana",
        extensions: ["i2g"]
      },
      "application/vnd.intertrust.digibox": {
        source: "iana"
      },
      "application/vnd.intertrust.nncp": {
        source: "iana"
      },
      "application/vnd.intu.qbo": {
        source: "iana",
        extensions: ["qbo"]
      },
      "application/vnd.intu.qfx": {
        source: "iana",
        extensions: ["qfx"]
      },
      "application/vnd.iptc.g2.catalogitem+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.iptc.g2.conceptitem+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.iptc.g2.knowledgeitem+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.iptc.g2.newsitem+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.iptc.g2.newsmessage+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.iptc.g2.packageitem+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.iptc.g2.planningitem+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.ipunplugged.rcprofile": {
        source: "iana",
        extensions: ["rcprofile"]
      },
      "application/vnd.irepository.package+xml": {
        source: "iana",
        compressible: true,
        extensions: ["irp"]
      },
      "application/vnd.is-xpr": {
        source: "iana",
        extensions: ["xpr"]
      },
      "application/vnd.isac.fcs": {
        source: "iana",
        extensions: ["fcs"]
      },
      "application/vnd.iso11783-10+zip": {
        source: "iana",
        compressible: false
      },
      "application/vnd.jam": {
        source: "iana",
        extensions: ["jam"]
      },
      "application/vnd.japannet-directory-service": {
        source: "iana"
      },
      "application/vnd.japannet-jpnstore-wakeup": {
        source: "iana"
      },
      "application/vnd.japannet-payment-wakeup": {
        source: "iana"
      },
      "application/vnd.japannet-registration": {
        source: "iana"
      },
      "application/vnd.japannet-registration-wakeup": {
        source: "iana"
      },
      "application/vnd.japannet-setstore-wakeup": {
        source: "iana"
      },
      "application/vnd.japannet-verification": {
        source: "iana"
      },
      "application/vnd.japannet-verification-wakeup": {
        source: "iana"
      },
      "application/vnd.jcp.javame.midlet-rms": {
        source: "iana",
        extensions: ["rms"]
      },
      "application/vnd.jisp": {
        source: "iana",
        extensions: ["jisp"]
      },
      "application/vnd.joost.joda-archive": {
        source: "iana",
        extensions: ["joda"]
      },
      "application/vnd.jsk.isdn-ngn": {
        source: "iana"
      },
      "application/vnd.kahootz": {
        source: "iana",
        extensions: ["ktz", "ktr"]
      },
      "application/vnd.kde.karbon": {
        source: "iana",
        extensions: ["karbon"]
      },
      "application/vnd.kde.kchart": {
        source: "iana",
        extensions: ["chrt"]
      },
      "application/vnd.kde.kformula": {
        source: "iana",
        extensions: ["kfo"]
      },
      "application/vnd.kde.kivio": {
        source: "iana",
        extensions: ["flw"]
      },
      "application/vnd.kde.kontour": {
        source: "iana",
        extensions: ["kon"]
      },
      "application/vnd.kde.kpresenter": {
        source: "iana",
        extensions: ["kpr", "kpt"]
      },
      "application/vnd.kde.kspread": {
        source: "iana",
        extensions: ["ksp"]
      },
      "application/vnd.kde.kword": {
        source: "iana",
        extensions: ["kwd", "kwt"]
      },
      "application/vnd.kenameaapp": {
        source: "iana",
        extensions: ["htke"]
      },
      "application/vnd.kidspiration": {
        source: "iana",
        extensions: ["kia"]
      },
      "application/vnd.kinar": {
        source: "iana",
        extensions: ["kne", "knp"]
      },
      "application/vnd.koan": {
        source: "iana",
        extensions: ["skp", "skd", "skt", "skm"]
      },
      "application/vnd.kodak-descriptor": {
        source: "iana",
        extensions: ["sse"]
      },
      "application/vnd.las": {
        source: "iana"
      },
      "application/vnd.las.las+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.las.las+xml": {
        source: "iana",
        compressible: true,
        extensions: ["lasxml"]
      },
      "application/vnd.laszip": {
        source: "iana"
      },
      "application/vnd.leap+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.liberty-request+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.llamagraphics.life-balance.desktop": {
        source: "iana",
        extensions: ["lbd"]
      },
      "application/vnd.llamagraphics.life-balance.exchange+xml": {
        source: "iana",
        compressible: true,
        extensions: ["lbe"]
      },
      "application/vnd.logipipe.circuit+zip": {
        source: "iana",
        compressible: false
      },
      "application/vnd.loom": {
        source: "iana"
      },
      "application/vnd.lotus-1-2-3": {
        source: "iana",
        extensions: ["123"]
      },
      "application/vnd.lotus-approach": {
        source: "iana",
        extensions: ["apr"]
      },
      "application/vnd.lotus-freelance": {
        source: "iana",
        extensions: ["pre"]
      },
      "application/vnd.lotus-notes": {
        source: "iana",
        extensions: ["nsf"]
      },
      "application/vnd.lotus-organizer": {
        source: "iana",
        extensions: ["org"]
      },
      "application/vnd.lotus-screencam": {
        source: "iana",
        extensions: ["scm"]
      },
      "application/vnd.lotus-wordpro": {
        source: "iana",
        extensions: ["lwp"]
      },
      "application/vnd.macports.portpkg": {
        source: "iana",
        extensions: ["portpkg"]
      },
      "application/vnd.mapbox-vector-tile": {
        source: "iana",
        extensions: ["mvt"]
      },
      "application/vnd.marlin.drm.actiontoken+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.marlin.drm.conftoken+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.marlin.drm.license+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.marlin.drm.mdcf": {
        source: "iana"
      },
      "application/vnd.mason+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.maxar.archive.3tz+zip": {
        source: "iana",
        compressible: false
      },
      "application/vnd.maxmind.maxmind-db": {
        source: "iana"
      },
      "application/vnd.mcd": {
        source: "iana",
        extensions: ["mcd"]
      },
      "application/vnd.medcalcdata": {
        source: "iana",
        extensions: ["mc1"]
      },
      "application/vnd.mediastation.cdkey": {
        source: "iana",
        extensions: ["cdkey"]
      },
      "application/vnd.meridian-slingshot": {
        source: "iana"
      },
      "application/vnd.mfer": {
        source: "iana",
        extensions: ["mwf"]
      },
      "application/vnd.mfmp": {
        source: "iana",
        extensions: ["mfm"]
      },
      "application/vnd.micro+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.micrografx.flo": {
        source: "iana",
        extensions: ["flo"]
      },
      "application/vnd.micrografx.igx": {
        source: "iana",
        extensions: ["igx"]
      },
      "application/vnd.microsoft.portable-executable": {
        source: "iana"
      },
      "application/vnd.microsoft.windows.thumbnail-cache": {
        source: "iana"
      },
      "application/vnd.miele+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.mif": {
        source: "iana",
        extensions: ["mif"]
      },
      "application/vnd.minisoft-hp3000-save": {
        source: "iana"
      },
      "application/vnd.mitsubishi.misty-guard.trustweb": {
        source: "iana"
      },
      "application/vnd.mobius.daf": {
        source: "iana",
        extensions: ["daf"]
      },
      "application/vnd.mobius.dis": {
        source: "iana",
        extensions: ["dis"]
      },
      "application/vnd.mobius.mbk": {
        source: "iana",
        extensions: ["mbk"]
      },
      "application/vnd.mobius.mqy": {
        source: "iana",
        extensions: ["mqy"]
      },
      "application/vnd.mobius.msl": {
        source: "iana",
        extensions: ["msl"]
      },
      "application/vnd.mobius.plc": {
        source: "iana",
        extensions: ["plc"]
      },
      "application/vnd.mobius.txf": {
        source: "iana",
        extensions: ["txf"]
      },
      "application/vnd.mophun.application": {
        source: "iana",
        extensions: ["mpn"]
      },
      "application/vnd.mophun.certificate": {
        source: "iana",
        extensions: ["mpc"]
      },
      "application/vnd.motorola.flexsuite": {
        source: "iana"
      },
      "application/vnd.motorola.flexsuite.adsi": {
        source: "iana"
      },
      "application/vnd.motorola.flexsuite.fis": {
        source: "iana"
      },
      "application/vnd.motorola.flexsuite.gotap": {
        source: "iana"
      },
      "application/vnd.motorola.flexsuite.kmr": {
        source: "iana"
      },
      "application/vnd.motorola.flexsuite.ttc": {
        source: "iana"
      },
      "application/vnd.motorola.flexsuite.wem": {
        source: "iana"
      },
      "application/vnd.motorola.iprm": {
        source: "iana"
      },
      "application/vnd.mozilla.xul+xml": {
        source: "iana",
        compressible: true,
        extensions: ["xul"]
      },
      "application/vnd.ms-3mfdocument": {
        source: "iana"
      },
      "application/vnd.ms-artgalry": {
        source: "iana",
        extensions: ["cil"]
      },
      "application/vnd.ms-asf": {
        source: "iana"
      },
      "application/vnd.ms-cab-compressed": {
        source: "iana",
        extensions: ["cab"]
      },
      "application/vnd.ms-color.iccprofile": {
        source: "apache"
      },
      "application/vnd.ms-excel": {
        source: "iana",
        compressible: false,
        extensions: ["xls", "xlm", "xla", "xlc", "xlt", "xlw"]
      },
      "application/vnd.ms-excel.addin.macroenabled.12": {
        source: "iana",
        extensions: ["xlam"]
      },
      "application/vnd.ms-excel.sheet.binary.macroenabled.12": {
        source: "iana",
        extensions: ["xlsb"]
      },
      "application/vnd.ms-excel.sheet.macroenabled.12": {
        source: "iana",
        extensions: ["xlsm"]
      },
      "application/vnd.ms-excel.template.macroenabled.12": {
        source: "iana",
        extensions: ["xltm"]
      },
      "application/vnd.ms-fontobject": {
        source: "iana",
        compressible: true,
        extensions: ["eot"]
      },
      "application/vnd.ms-htmlhelp": {
        source: "iana",
        extensions: ["chm"]
      },
      "application/vnd.ms-ims": {
        source: "iana",
        extensions: ["ims"]
      },
      "application/vnd.ms-lrm": {
        source: "iana",
        extensions: ["lrm"]
      },
      "application/vnd.ms-office.activex+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.ms-officetheme": {
        source: "iana",
        extensions: ["thmx"]
      },
      "application/vnd.ms-opentype": {
        source: "apache",
        compressible: true
      },
      "application/vnd.ms-outlook": {
        compressible: false,
        extensions: ["msg"]
      },
      "application/vnd.ms-package.obfuscated-opentype": {
        source: "apache"
      },
      "application/vnd.ms-pki.seccat": {
        source: "apache",
        extensions: ["cat"]
      },
      "application/vnd.ms-pki.stl": {
        source: "apache",
        extensions: ["stl"]
      },
      "application/vnd.ms-playready.initiator+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.ms-powerpoint": {
        source: "iana",
        compressible: false,
        extensions: ["ppt", "pps", "pot"]
      },
      "application/vnd.ms-powerpoint.addin.macroenabled.12": {
        source: "iana",
        extensions: ["ppam"]
      },
      "application/vnd.ms-powerpoint.presentation.macroenabled.12": {
        source: "iana",
        extensions: ["pptm"]
      },
      "application/vnd.ms-powerpoint.slide.macroenabled.12": {
        source: "iana",
        extensions: ["sldm"]
      },
      "application/vnd.ms-powerpoint.slideshow.macroenabled.12": {
        source: "iana",
        extensions: ["ppsm"]
      },
      "application/vnd.ms-powerpoint.template.macroenabled.12": {
        source: "iana",
        extensions: ["potm"]
      },
      "application/vnd.ms-printdevicecapabilities+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.ms-printing.printticket+xml": {
        source: "apache",
        compressible: true
      },
      "application/vnd.ms-printschematicket+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.ms-project": {
        source: "iana",
        extensions: ["mpp", "mpt"]
      },
      "application/vnd.ms-tnef": {
        source: "iana"
      },
      "application/vnd.ms-windows.devicepairing": {
        source: "iana"
      },
      "application/vnd.ms-windows.nwprinting.oob": {
        source: "iana"
      },
      "application/vnd.ms-windows.printerpairing": {
        source: "iana"
      },
      "application/vnd.ms-windows.wsd.oob": {
        source: "iana"
      },
      "application/vnd.ms-wmdrm.lic-chlg-req": {
        source: "iana"
      },
      "application/vnd.ms-wmdrm.lic-resp": {
        source: "iana"
      },
      "application/vnd.ms-wmdrm.meter-chlg-req": {
        source: "iana"
      },
      "application/vnd.ms-wmdrm.meter-resp": {
        source: "iana"
      },
      "application/vnd.ms-word.document.macroenabled.12": {
        source: "iana",
        extensions: ["docm"]
      },
      "application/vnd.ms-word.template.macroenabled.12": {
        source: "iana",
        extensions: ["dotm"]
      },
      "application/vnd.ms-works": {
        source: "iana",
        extensions: ["wps", "wks", "wcm", "wdb"]
      },
      "application/vnd.ms-wpl": {
        source: "iana",
        extensions: ["wpl"]
      },
      "application/vnd.ms-xpsdocument": {
        source: "iana",
        compressible: false,
        extensions: ["xps"]
      },
      "application/vnd.msa-disk-image": {
        source: "iana"
      },
      "application/vnd.mseq": {
        source: "iana",
        extensions: ["mseq"]
      },
      "application/vnd.msign": {
        source: "iana"
      },
      "application/vnd.multiad.creator": {
        source: "iana"
      },
      "application/vnd.multiad.creator.cif": {
        source: "iana"
      },
      "application/vnd.music-niff": {
        source: "iana"
      },
      "application/vnd.musician": {
        source: "iana",
        extensions: ["mus"]
      },
      "application/vnd.muvee.style": {
        source: "iana",
        extensions: ["msty"]
      },
      "application/vnd.mynfc": {
        source: "iana",
        extensions: ["taglet"]
      },
      "application/vnd.nacamar.ybrid+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.ncd.control": {
        source: "iana"
      },
      "application/vnd.ncd.reference": {
        source: "iana"
      },
      "application/vnd.nearst.inv+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.nebumind.line": {
        source: "iana"
      },
      "application/vnd.nervana": {
        source: "iana"
      },
      "application/vnd.netfpx": {
        source: "iana"
      },
      "application/vnd.neurolanguage.nlu": {
        source: "iana",
        extensions: ["nlu"]
      },
      "application/vnd.nimn": {
        source: "iana"
      },
      "application/vnd.nintendo.nitro.rom": {
        source: "iana"
      },
      "application/vnd.nintendo.snes.rom": {
        source: "iana"
      },
      "application/vnd.nitf": {
        source: "iana",
        extensions: ["ntf", "nitf"]
      },
      "application/vnd.noblenet-directory": {
        source: "iana",
        extensions: ["nnd"]
      },
      "application/vnd.noblenet-sealer": {
        source: "iana",
        extensions: ["nns"]
      },
      "application/vnd.noblenet-web": {
        source: "iana",
        extensions: ["nnw"]
      },
      "application/vnd.nokia.catalogs": {
        source: "iana"
      },
      "application/vnd.nokia.conml+wbxml": {
        source: "iana"
      },
      "application/vnd.nokia.conml+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.nokia.iptv.config+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.nokia.isds-radio-presets": {
        source: "iana"
      },
      "application/vnd.nokia.landmark+wbxml": {
        source: "iana"
      },
      "application/vnd.nokia.landmark+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.nokia.landmarkcollection+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.nokia.n-gage.ac+xml": {
        source: "iana",
        compressible: true,
        extensions: ["ac"]
      },
      "application/vnd.nokia.n-gage.data": {
        source: "iana",
        extensions: ["ngdat"]
      },
      "application/vnd.nokia.n-gage.symbian.install": {
        source: "iana",
        extensions: ["n-gage"]
      },
      "application/vnd.nokia.ncd": {
        source: "iana"
      },
      "application/vnd.nokia.pcd+wbxml": {
        source: "iana"
      },
      "application/vnd.nokia.pcd+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.nokia.radio-preset": {
        source: "iana",
        extensions: ["rpst"]
      },
      "application/vnd.nokia.radio-presets": {
        source: "iana",
        extensions: ["rpss"]
      },
      "application/vnd.novadigm.edm": {
        source: "iana",
        extensions: ["edm"]
      },
      "application/vnd.novadigm.edx": {
        source: "iana",
        extensions: ["edx"]
      },
      "application/vnd.novadigm.ext": {
        source: "iana",
        extensions: ["ext"]
      },
      "application/vnd.ntt-local.content-share": {
        source: "iana"
      },
      "application/vnd.ntt-local.file-transfer": {
        source: "iana"
      },
      "application/vnd.ntt-local.ogw_remote-access": {
        source: "iana"
      },
      "application/vnd.ntt-local.sip-ta_remote": {
        source: "iana"
      },
      "application/vnd.ntt-local.sip-ta_tcp_stream": {
        source: "iana"
      },
      "application/vnd.oasis.opendocument.chart": {
        source: "iana",
        extensions: ["odc"]
      },
      "application/vnd.oasis.opendocument.chart-template": {
        source: "iana",
        extensions: ["otc"]
      },
      "application/vnd.oasis.opendocument.database": {
        source: "iana",
        extensions: ["odb"]
      },
      "application/vnd.oasis.opendocument.formula": {
        source: "iana",
        extensions: ["odf"]
      },
      "application/vnd.oasis.opendocument.formula-template": {
        source: "iana",
        extensions: ["odft"]
      },
      "application/vnd.oasis.opendocument.graphics": {
        source: "iana",
        compressible: false,
        extensions: ["odg"]
      },
      "application/vnd.oasis.opendocument.graphics-template": {
        source: "iana",
        extensions: ["otg"]
      },
      "application/vnd.oasis.opendocument.image": {
        source: "iana",
        extensions: ["odi"]
      },
      "application/vnd.oasis.opendocument.image-template": {
        source: "iana",
        extensions: ["oti"]
      },
      "application/vnd.oasis.opendocument.presentation": {
        source: "iana",
        compressible: false,
        extensions: ["odp"]
      },
      "application/vnd.oasis.opendocument.presentation-template": {
        source: "iana",
        extensions: ["otp"]
      },
      "application/vnd.oasis.opendocument.spreadsheet": {
        source: "iana",
        compressible: false,
        extensions: ["ods"]
      },
      "application/vnd.oasis.opendocument.spreadsheet-template": {
        source: "iana",
        extensions: ["ots"]
      },
      "application/vnd.oasis.opendocument.text": {
        source: "iana",
        compressible: false,
        extensions: ["odt"]
      },
      "application/vnd.oasis.opendocument.text-master": {
        source: "iana",
        extensions: ["odm"]
      },
      "application/vnd.oasis.opendocument.text-template": {
        source: "iana",
        extensions: ["ott"]
      },
      "application/vnd.oasis.opendocument.text-web": {
        source: "iana",
        extensions: ["oth"]
      },
      "application/vnd.obn": {
        source: "iana"
      },
      "application/vnd.ocf+cbor": {
        source: "iana"
      },
      "application/vnd.oci.image.manifest.v1+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oftn.l10n+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oipf.contentaccessdownload+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oipf.contentaccessstreaming+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oipf.cspg-hexbinary": {
        source: "iana"
      },
      "application/vnd.oipf.dae.svg+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oipf.dae.xhtml+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oipf.mippvcontrolmessage+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oipf.pae.gem": {
        source: "iana"
      },
      "application/vnd.oipf.spdiscovery+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oipf.spdlist+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oipf.ueprofile+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oipf.userprofile+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.olpc-sugar": {
        source: "iana",
        extensions: ["xo"]
      },
      "application/vnd.oma-scws-config": {
        source: "iana"
      },
      "application/vnd.oma-scws-http-request": {
        source: "iana"
      },
      "application/vnd.oma-scws-http-response": {
        source: "iana"
      },
      "application/vnd.oma.bcast.associated-procedure-parameter+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.bcast.drm-trigger+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.bcast.imd+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.bcast.ltkm": {
        source: "iana"
      },
      "application/vnd.oma.bcast.notification+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.bcast.provisioningtrigger": {
        source: "iana"
      },
      "application/vnd.oma.bcast.sgboot": {
        source: "iana"
      },
      "application/vnd.oma.bcast.sgdd+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.bcast.sgdu": {
        source: "iana"
      },
      "application/vnd.oma.bcast.simple-symbol-container": {
        source: "iana"
      },
      "application/vnd.oma.bcast.smartcard-trigger+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.bcast.sprov+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.bcast.stkm": {
        source: "iana"
      },
      "application/vnd.oma.cab-address-book+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.cab-feature-handler+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.cab-pcc+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.cab-subs-invite+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.cab-user-prefs+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.dcd": {
        source: "iana"
      },
      "application/vnd.oma.dcdc": {
        source: "iana"
      },
      "application/vnd.oma.dd2+xml": {
        source: "iana",
        compressible: true,
        extensions: ["dd2"]
      },
      "application/vnd.oma.drm.risd+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.group-usage-list+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.lwm2m+cbor": {
        source: "iana"
      },
      "application/vnd.oma.lwm2m+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.lwm2m+tlv": {
        source: "iana"
      },
      "application/vnd.oma.pal+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.poc.detailed-progress-report+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.poc.final-report+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.poc.groups+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.poc.invocation-descriptor+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.poc.optimized-progress-report+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.push": {
        source: "iana"
      },
      "application/vnd.oma.scidm.messages+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oma.xcap-directory+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.omads-email+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/vnd.omads-file+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/vnd.omads-folder+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/vnd.omaloc-supl-init": {
        source: "iana"
      },
      "application/vnd.onepager": {
        source: "iana"
      },
      "application/vnd.onepagertamp": {
        source: "iana"
      },
      "application/vnd.onepagertamx": {
        source: "iana"
      },
      "application/vnd.onepagertat": {
        source: "iana"
      },
      "application/vnd.onepagertatp": {
        source: "iana"
      },
      "application/vnd.onepagertatx": {
        source: "iana"
      },
      "application/vnd.openblox.game+xml": {
        source: "iana",
        compressible: true,
        extensions: ["obgx"]
      },
      "application/vnd.openblox.game-binary": {
        source: "iana"
      },
      "application/vnd.openeye.oeb": {
        source: "iana"
      },
      "application/vnd.openofficeorg.extension": {
        source: "apache",
        extensions: ["oxt"]
      },
      "application/vnd.openstreetmap.data+xml": {
        source: "iana",
        compressible: true,
        extensions: ["osm"]
      },
      "application/vnd.opentimestamps.ots": {
        source: "iana"
      },
      "application/vnd.openxmlformats-officedocument.custom-properties+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.customxmlproperties+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.drawing+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.drawingml.chart+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.drawingml.chartshapes+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.drawingml.diagramcolors+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.drawingml.diagramdata+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.drawingml.diagramlayout+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.drawingml.diagramstyle+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.extended-properties+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.presentationml.commentauthors+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.presentationml.comments+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.presentationml.handoutmaster+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.presentationml.notesmaster+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.presentationml.notesslide+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
        source: "iana",
        compressible: false,
        extensions: ["pptx"]
      },
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.presentationml.presprops+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.presentationml.slide": {
        source: "iana",
        extensions: ["sldx"]
      },
      "application/vnd.openxmlformats-officedocument.presentationml.slide+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.presentationml.slidelayout+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.presentationml.slidemaster+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.presentationml.slideshow": {
        source: "iana",
        extensions: ["ppsx"]
      },
      "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.presentationml.slideupdateinfo+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.presentationml.tablestyles+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.presentationml.tags+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.presentationml.template": {
        source: "iana",
        extensions: ["potx"]
      },
      "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.presentationml.viewprops+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.calcchain+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.dialogsheet+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.externallink+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotcachedefinition+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotcacherecords+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.pivottable+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.querytable+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.revisionheaders+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.revisionlog+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedstrings+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
        source: "iana",
        compressible: false,
        extensions: ["xlsx"]
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheetmetadata+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.tablesinglecells+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.template": {
        source: "iana",
        extensions: ["xltx"]
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.usernames+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.volatiledependencies+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.theme+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.themeoverride+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.vmldrawing": {
        source: "iana"
      },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
        source: "iana",
        compressible: false,
        extensions: ["docx"]
      },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.fonttable+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.template": {
        source: "iana",
        extensions: ["dotx"]
      },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.websettings+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-package.core-properties+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.openxmlformats-package.relationships+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oracle.resource+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.orange.indata": {
        source: "iana"
      },
      "application/vnd.osa.netdeploy": {
        source: "iana"
      },
      "application/vnd.osgeo.mapguide.package": {
        source: "iana",
        extensions: ["mgp"]
      },
      "application/vnd.osgi.bundle": {
        source: "iana"
      },
      "application/vnd.osgi.dp": {
        source: "iana",
        extensions: ["dp"]
      },
      "application/vnd.osgi.subsystem": {
        source: "iana",
        extensions: ["esa"]
      },
      "application/vnd.otps.ct-kip+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.oxli.countgraph": {
        source: "iana"
      },
      "application/vnd.pagerduty+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.palm": {
        source: "iana",
        extensions: ["pdb", "pqa", "oprc"]
      },
      "application/vnd.panoply": {
        source: "iana"
      },
      "application/vnd.paos.xml": {
        source: "iana"
      },
      "application/vnd.patentdive": {
        source: "iana"
      },
      "application/vnd.patientecommsdoc": {
        source: "iana"
      },
      "application/vnd.pawaafile": {
        source: "iana",
        extensions: ["paw"]
      },
      "application/vnd.pcos": {
        source: "iana"
      },
      "application/vnd.pg.format": {
        source: "iana",
        extensions: ["str"]
      },
      "application/vnd.pg.osasli": {
        source: "iana",
        extensions: ["ei6"]
      },
      "application/vnd.piaccess.application-licence": {
        source: "iana"
      },
      "application/vnd.picsel": {
        source: "iana",
        extensions: ["efif"]
      },
      "application/vnd.pmi.widget": {
        source: "iana",
        extensions: ["wg"]
      },
      "application/vnd.poc.group-advertisement+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.pocketlearn": {
        source: "iana",
        extensions: ["plf"]
      },
      "application/vnd.powerbuilder6": {
        source: "iana",
        extensions: ["pbd"]
      },
      "application/vnd.powerbuilder6-s": {
        source: "iana"
      },
      "application/vnd.powerbuilder7": {
        source: "iana"
      },
      "application/vnd.powerbuilder7-s": {
        source: "iana"
      },
      "application/vnd.powerbuilder75": {
        source: "iana"
      },
      "application/vnd.powerbuilder75-s": {
        source: "iana"
      },
      "application/vnd.preminet": {
        source: "iana"
      },
      "application/vnd.previewsystems.box": {
        source: "iana",
        extensions: ["box"]
      },
      "application/vnd.proteus.magazine": {
        source: "iana",
        extensions: ["mgz"]
      },
      "application/vnd.psfs": {
        source: "iana"
      },
      "application/vnd.publishare-delta-tree": {
        source: "iana",
        extensions: ["qps"]
      },
      "application/vnd.pvi.ptid1": {
        source: "iana",
        extensions: ["ptid"]
      },
      "application/vnd.pwg-multiplexed": {
        source: "iana"
      },
      "application/vnd.pwg-xhtml-print+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.qualcomm.brew-app-res": {
        source: "iana"
      },
      "application/vnd.quarantainenet": {
        source: "iana"
      },
      "application/vnd.quark.quarkxpress": {
        source: "iana",
        extensions: ["qxd", "qxt", "qwd", "qwt", "qxl", "qxb"]
      },
      "application/vnd.quobject-quoxdocument": {
        source: "iana"
      },
      "application/vnd.radisys.moml+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.radisys.msml+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.radisys.msml-audit+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.radisys.msml-audit-conf+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.radisys.msml-audit-conn+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.radisys.msml-audit-dialog+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.radisys.msml-audit-stream+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.radisys.msml-conf+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.radisys.msml-dialog+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.radisys.msml-dialog-base+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.radisys.msml-dialog-fax-detect+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.radisys.msml-dialog-fax-sendrecv+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.radisys.msml-dialog-group+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.radisys.msml-dialog-speech+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.radisys.msml-dialog-transform+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.rainstor.data": {
        source: "iana"
      },
      "application/vnd.rapid": {
        source: "iana"
      },
      "application/vnd.rar": {
        source: "iana",
        extensions: ["rar"]
      },
      "application/vnd.realvnc.bed": {
        source: "iana",
        extensions: ["bed"]
      },
      "application/vnd.recordare.musicxml": {
        source: "iana",
        extensions: ["mxl"]
      },
      "application/vnd.recordare.musicxml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["musicxml"]
      },
      "application/vnd.renlearn.rlprint": {
        source: "iana"
      },
      "application/vnd.resilient.logic": {
        source: "iana"
      },
      "application/vnd.restful+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.rig.cryptonote": {
        source: "iana",
        extensions: ["cryptonote"]
      },
      "application/vnd.rim.cod": {
        source: "apache",
        extensions: ["cod"]
      },
      "application/vnd.rn-realmedia": {
        source: "apache",
        extensions: ["rm"]
      },
      "application/vnd.rn-realmedia-vbr": {
        source: "apache",
        extensions: ["rmvb"]
      },
      "application/vnd.route66.link66+xml": {
        source: "iana",
        compressible: true,
        extensions: ["link66"]
      },
      "application/vnd.rs-274x": {
        source: "iana"
      },
      "application/vnd.ruckus.download": {
        source: "iana"
      },
      "application/vnd.s3sms": {
        source: "iana"
      },
      "application/vnd.sailingtracker.track": {
        source: "iana",
        extensions: ["st"]
      },
      "application/vnd.sar": {
        source: "iana"
      },
      "application/vnd.sbm.cid": {
        source: "iana"
      },
      "application/vnd.sbm.mid2": {
        source: "iana"
      },
      "application/vnd.scribus": {
        source: "iana"
      },
      "application/vnd.sealed.3df": {
        source: "iana"
      },
      "application/vnd.sealed.csf": {
        source: "iana"
      },
      "application/vnd.sealed.doc": {
        source: "iana"
      },
      "application/vnd.sealed.eml": {
        source: "iana"
      },
      "application/vnd.sealed.mht": {
        source: "iana"
      },
      "application/vnd.sealed.net": {
        source: "iana"
      },
      "application/vnd.sealed.ppt": {
        source: "iana"
      },
      "application/vnd.sealed.tiff": {
        source: "iana"
      },
      "application/vnd.sealed.xls": {
        source: "iana"
      },
      "application/vnd.sealedmedia.softseal.html": {
        source: "iana"
      },
      "application/vnd.sealedmedia.softseal.pdf": {
        source: "iana"
      },
      "application/vnd.seemail": {
        source: "iana",
        extensions: ["see"]
      },
      "application/vnd.seis+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.sema": {
        source: "iana",
        extensions: ["sema"]
      },
      "application/vnd.semd": {
        source: "iana",
        extensions: ["semd"]
      },
      "application/vnd.semf": {
        source: "iana",
        extensions: ["semf"]
      },
      "application/vnd.shade-save-file": {
        source: "iana"
      },
      "application/vnd.shana.informed.formdata": {
        source: "iana",
        extensions: ["ifm"]
      },
      "application/vnd.shana.informed.formtemplate": {
        source: "iana",
        extensions: ["itp"]
      },
      "application/vnd.shana.informed.interchange": {
        source: "iana",
        extensions: ["iif"]
      },
      "application/vnd.shana.informed.package": {
        source: "iana",
        extensions: ["ipk"]
      },
      "application/vnd.shootproof+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.shopkick+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.shp": {
        source: "iana"
      },
      "application/vnd.shx": {
        source: "iana"
      },
      "application/vnd.sigrok.session": {
        source: "iana"
      },
      "application/vnd.simtech-mindmapper": {
        source: "iana",
        extensions: ["twd", "twds"]
      },
      "application/vnd.siren+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.smaf": {
        source: "iana",
        extensions: ["mmf"]
      },
      "application/vnd.smart.notebook": {
        source: "iana"
      },
      "application/vnd.smart.teacher": {
        source: "iana",
        extensions: ["teacher"]
      },
      "application/vnd.snesdev-page-table": {
        source: "iana"
      },
      "application/vnd.software602.filler.form+xml": {
        source: "iana",
        compressible: true,
        extensions: ["fo"]
      },
      "application/vnd.software602.filler.form-xml-zip": {
        source: "iana"
      },
      "application/vnd.solent.sdkm+xml": {
        source: "iana",
        compressible: true,
        extensions: ["sdkm", "sdkd"]
      },
      "application/vnd.spotfire.dxp": {
        source: "iana",
        extensions: ["dxp"]
      },
      "application/vnd.spotfire.sfs": {
        source: "iana",
        extensions: ["sfs"]
      },
      "application/vnd.sqlite3": {
        source: "iana"
      },
      "application/vnd.sss-cod": {
        source: "iana"
      },
      "application/vnd.sss-dtf": {
        source: "iana"
      },
      "application/vnd.sss-ntf": {
        source: "iana"
      },
      "application/vnd.stardivision.calc": {
        source: "apache",
        extensions: ["sdc"]
      },
      "application/vnd.stardivision.draw": {
        source: "apache",
        extensions: ["sda"]
      },
      "application/vnd.stardivision.impress": {
        source: "apache",
        extensions: ["sdd"]
      },
      "application/vnd.stardivision.math": {
        source: "apache",
        extensions: ["smf"]
      },
      "application/vnd.stardivision.writer": {
        source: "apache",
        extensions: ["sdw", "vor"]
      },
      "application/vnd.stardivision.writer-global": {
        source: "apache",
        extensions: ["sgl"]
      },
      "application/vnd.stepmania.package": {
        source: "iana",
        extensions: ["smzip"]
      },
      "application/vnd.stepmania.stepchart": {
        source: "iana",
        extensions: ["sm"]
      },
      "application/vnd.street-stream": {
        source: "iana"
      },
      "application/vnd.sun.wadl+xml": {
        source: "iana",
        compressible: true,
        extensions: ["wadl"]
      },
      "application/vnd.sun.xml.calc": {
        source: "apache",
        extensions: ["sxc"]
      },
      "application/vnd.sun.xml.calc.template": {
        source: "apache",
        extensions: ["stc"]
      },
      "application/vnd.sun.xml.draw": {
        source: "apache",
        extensions: ["sxd"]
      },
      "application/vnd.sun.xml.draw.template": {
        source: "apache",
        extensions: ["std"]
      },
      "application/vnd.sun.xml.impress": {
        source: "apache",
        extensions: ["sxi"]
      },
      "application/vnd.sun.xml.impress.template": {
        source: "apache",
        extensions: ["sti"]
      },
      "application/vnd.sun.xml.math": {
        source: "apache",
        extensions: ["sxm"]
      },
      "application/vnd.sun.xml.writer": {
        source: "apache",
        extensions: ["sxw"]
      },
      "application/vnd.sun.xml.writer.global": {
        source: "apache",
        extensions: ["sxg"]
      },
      "application/vnd.sun.xml.writer.template": {
        source: "apache",
        extensions: ["stw"]
      },
      "application/vnd.sus-calendar": {
        source: "iana",
        extensions: ["sus", "susp"]
      },
      "application/vnd.svd": {
        source: "iana",
        extensions: ["svd"]
      },
      "application/vnd.swiftview-ics": {
        source: "iana"
      },
      "application/vnd.sycle+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.syft+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.symbian.install": {
        source: "apache",
        extensions: ["sis", "sisx"]
      },
      "application/vnd.syncml+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true,
        extensions: ["xsm"]
      },
      "application/vnd.syncml.dm+wbxml": {
        source: "iana",
        charset: "UTF-8",
        extensions: ["bdm"]
      },
      "application/vnd.syncml.dm+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true,
        extensions: ["xdm"]
      },
      "application/vnd.syncml.dm.notification": {
        source: "iana"
      },
      "application/vnd.syncml.dmddf+wbxml": {
        source: "iana"
      },
      "application/vnd.syncml.dmddf+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true,
        extensions: ["ddf"]
      },
      "application/vnd.syncml.dmtnds+wbxml": {
        source: "iana"
      },
      "application/vnd.syncml.dmtnds+xml": {
        source: "iana",
        charset: "UTF-8",
        compressible: true
      },
      "application/vnd.syncml.ds.notification": {
        source: "iana"
      },
      "application/vnd.tableschema+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.tao.intent-module-archive": {
        source: "iana",
        extensions: ["tao"]
      },
      "application/vnd.tcpdump.pcap": {
        source: "iana",
        extensions: ["pcap", "cap", "dmp"]
      },
      "application/vnd.think-cell.ppttc+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.tmd.mediaflex.api+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.tml": {
        source: "iana"
      },
      "application/vnd.tmobile-livetv": {
        source: "iana",
        extensions: ["tmo"]
      },
      "application/vnd.tri.onesource": {
        source: "iana"
      },
      "application/vnd.trid.tpt": {
        source: "iana",
        extensions: ["tpt"]
      },
      "application/vnd.triscape.mxs": {
        source: "iana",
        extensions: ["mxs"]
      },
      "application/vnd.trueapp": {
        source: "iana",
        extensions: ["tra"]
      },
      "application/vnd.truedoc": {
        source: "iana"
      },
      "application/vnd.ubisoft.webplayer": {
        source: "iana"
      },
      "application/vnd.ufdl": {
        source: "iana",
        extensions: ["ufd", "ufdl"]
      },
      "application/vnd.uiq.theme": {
        source: "iana",
        extensions: ["utz"]
      },
      "application/vnd.umajin": {
        source: "iana",
        extensions: ["umj"]
      },
      "application/vnd.unity": {
        source: "iana",
        extensions: ["unityweb"]
      },
      "application/vnd.uoml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["uoml"]
      },
      "application/vnd.uplanet.alert": {
        source: "iana"
      },
      "application/vnd.uplanet.alert-wbxml": {
        source: "iana"
      },
      "application/vnd.uplanet.bearer-choice": {
        source: "iana"
      },
      "application/vnd.uplanet.bearer-choice-wbxml": {
        source: "iana"
      },
      "application/vnd.uplanet.cacheop": {
        source: "iana"
      },
      "application/vnd.uplanet.cacheop-wbxml": {
        source: "iana"
      },
      "application/vnd.uplanet.channel": {
        source: "iana"
      },
      "application/vnd.uplanet.channel-wbxml": {
        source: "iana"
      },
      "application/vnd.uplanet.list": {
        source: "iana"
      },
      "application/vnd.uplanet.list-wbxml": {
        source: "iana"
      },
      "application/vnd.uplanet.listcmd": {
        source: "iana"
      },
      "application/vnd.uplanet.listcmd-wbxml": {
        source: "iana"
      },
      "application/vnd.uplanet.signal": {
        source: "iana"
      },
      "application/vnd.uri-map": {
        source: "iana"
      },
      "application/vnd.valve.source.material": {
        source: "iana"
      },
      "application/vnd.vcx": {
        source: "iana",
        extensions: ["vcx"]
      },
      "application/vnd.vd-study": {
        source: "iana"
      },
      "application/vnd.vectorworks": {
        source: "iana"
      },
      "application/vnd.vel+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.verimatrix.vcas": {
        source: "iana"
      },
      "application/vnd.veritone.aion+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.veryant.thin": {
        source: "iana"
      },
      "application/vnd.ves.encrypted": {
        source: "iana"
      },
      "application/vnd.vidsoft.vidconference": {
        source: "iana"
      },
      "application/vnd.visio": {
        source: "iana",
        extensions: ["vsd", "vst", "vss", "vsw"]
      },
      "application/vnd.visionary": {
        source: "iana",
        extensions: ["vis"]
      },
      "application/vnd.vividence.scriptfile": {
        source: "iana"
      },
      "application/vnd.vsf": {
        source: "iana",
        extensions: ["vsf"]
      },
      "application/vnd.wap.sic": {
        source: "iana"
      },
      "application/vnd.wap.slc": {
        source: "iana"
      },
      "application/vnd.wap.wbxml": {
        source: "iana",
        charset: "UTF-8",
        extensions: ["wbxml"]
      },
      "application/vnd.wap.wmlc": {
        source: "iana",
        extensions: ["wmlc"]
      },
      "application/vnd.wap.wmlscriptc": {
        source: "iana",
        extensions: ["wmlsc"]
      },
      "application/vnd.webturbo": {
        source: "iana",
        extensions: ["wtb"]
      },
      "application/vnd.wfa.dpp": {
        source: "iana"
      },
      "application/vnd.wfa.p2p": {
        source: "iana"
      },
      "application/vnd.wfa.wsc": {
        source: "iana"
      },
      "application/vnd.windows.devicepairing": {
        source: "iana"
      },
      "application/vnd.wmc": {
        source: "iana"
      },
      "application/vnd.wmf.bootstrap": {
        source: "iana"
      },
      "application/vnd.wolfram.mathematica": {
        source: "iana"
      },
      "application/vnd.wolfram.mathematica.package": {
        source: "iana"
      },
      "application/vnd.wolfram.player": {
        source: "iana",
        extensions: ["nbp"]
      },
      "application/vnd.wordperfect": {
        source: "iana",
        extensions: ["wpd"]
      },
      "application/vnd.wqd": {
        source: "iana",
        extensions: ["wqd"]
      },
      "application/vnd.wrq-hp3000-labelled": {
        source: "iana"
      },
      "application/vnd.wt.stf": {
        source: "iana",
        extensions: ["stf"]
      },
      "application/vnd.wv.csp+wbxml": {
        source: "iana"
      },
      "application/vnd.wv.csp+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.wv.ssp+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.xacml+json": {
        source: "iana",
        compressible: true
      },
      "application/vnd.xara": {
        source: "iana",
        extensions: ["xar"]
      },
      "application/vnd.xfdl": {
        source: "iana",
        extensions: ["xfdl"]
      },
      "application/vnd.xfdl.webform": {
        source: "iana"
      },
      "application/vnd.xmi+xml": {
        source: "iana",
        compressible: true
      },
      "application/vnd.xmpie.cpkg": {
        source: "iana"
      },
      "application/vnd.xmpie.dpkg": {
        source: "iana"
      },
      "application/vnd.xmpie.plan": {
        source: "iana"
      },
      "application/vnd.xmpie.ppkg": {
        source: "iana"
      },
      "application/vnd.xmpie.xlim": {
        source: "iana"
      },
      "application/vnd.yamaha.hv-dic": {
        source: "iana",
        extensions: ["hvd"]
      },
      "application/vnd.yamaha.hv-script": {
        source: "iana",
        extensions: ["hvs"]
      },
      "application/vnd.yamaha.hv-voice": {
        source: "iana",
        extensions: ["hvp"]
      },
      "application/vnd.yamaha.openscoreformat": {
        source: "iana",
        extensions: ["osf"]
      },
      "application/vnd.yamaha.openscoreformat.osfpvg+xml": {
        source: "iana",
        compressible: true,
        extensions: ["osfpvg"]
      },
      "application/vnd.yamaha.remote-setup": {
        source: "iana"
      },
      "application/vnd.yamaha.smaf-audio": {
        source: "iana",
        extensions: ["saf"]
      },
      "application/vnd.yamaha.smaf-phrase": {
        source: "iana",
        extensions: ["spf"]
      },
      "application/vnd.yamaha.through-ngn": {
        source: "iana"
      },
      "application/vnd.yamaha.tunnel-udpencap": {
        source: "iana"
      },
      "application/vnd.yaoweme": {
        source: "iana"
      },
      "application/vnd.yellowriver-custom-menu": {
        source: "iana",
        extensions: ["cmp"]
      },
      "application/vnd.youtube.yt": {
        source: "iana"
      },
      "application/vnd.zul": {
        source: "iana",
        extensions: ["zir", "zirz"]
      },
      "application/vnd.zzazz.deck+xml": {
        source: "iana",
        compressible: true,
        extensions: ["zaz"]
      },
      "application/voicexml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["vxml"]
      },
      "application/voucher-cms+json": {
        source: "iana",
        compressible: true
      },
      "application/vq-rtcpxr": {
        source: "iana"
      },
      "application/wasm": {
        source: "iana",
        compressible: true,
        extensions: ["wasm"]
      },
      "application/watcherinfo+xml": {
        source: "iana",
        compressible: true,
        extensions: ["wif"]
      },
      "application/webpush-options+json": {
        source: "iana",
        compressible: true
      },
      "application/whoispp-query": {
        source: "iana"
      },
      "application/whoispp-response": {
        source: "iana"
      },
      "application/widget": {
        source: "iana",
        extensions: ["wgt"]
      },
      "application/winhlp": {
        source: "apache",
        extensions: ["hlp"]
      },
      "application/wita": {
        source: "iana"
      },
      "application/wordperfect5.1": {
        source: "iana"
      },
      "application/wsdl+xml": {
        source: "iana",
        compressible: true,
        extensions: ["wsdl"]
      },
      "application/wspolicy+xml": {
        source: "iana",
        compressible: true,
        extensions: ["wspolicy"]
      },
      "application/x-7z-compressed": {
        source: "apache",
        compressible: false,
        extensions: ["7z"]
      },
      "application/x-abiword": {
        source: "apache",
        extensions: ["abw"]
      },
      "application/x-ace-compressed": {
        source: "apache",
        extensions: ["ace"]
      },
      "application/x-amf": {
        source: "apache"
      },
      "application/x-apple-diskimage": {
        source: "apache",
        extensions: ["dmg"]
      },
      "application/x-arj": {
        compressible: false,
        extensions: ["arj"]
      },
      "application/x-authorware-bin": {
        source: "apache",
        extensions: ["aab", "x32", "u32", "vox"]
      },
      "application/x-authorware-map": {
        source: "apache",
        extensions: ["aam"]
      },
      "application/x-authorware-seg": {
        source: "apache",
        extensions: ["aas"]
      },
      "application/x-bcpio": {
        source: "apache",
        extensions: ["bcpio"]
      },
      "application/x-bdoc": {
        compressible: false,
        extensions: ["bdoc"]
      },
      "application/x-bittorrent": {
        source: "apache",
        extensions: ["torrent"]
      },
      "application/x-blorb": {
        source: "apache",
        extensions: ["blb", "blorb"]
      },
      "application/x-bzip": {
        source: "apache",
        compressible: false,
        extensions: ["bz"]
      },
      "application/x-bzip2": {
        source: "apache",
        compressible: false,
        extensions: ["bz2", "boz"]
      },
      "application/x-cbr": {
        source: "apache",
        extensions: ["cbr", "cba", "cbt", "cbz", "cb7"]
      },
      "application/x-cdlink": {
        source: "apache",
        extensions: ["vcd"]
      },
      "application/x-cfs-compressed": {
        source: "apache",
        extensions: ["cfs"]
      },
      "application/x-chat": {
        source: "apache",
        extensions: ["chat"]
      },
      "application/x-chess-pgn": {
        source: "apache",
        extensions: ["pgn"]
      },
      "application/x-chrome-extension": {
        extensions: ["crx"]
      },
      "application/x-cocoa": {
        source: "nginx",
        extensions: ["cco"]
      },
      "application/x-compress": {
        source: "apache"
      },
      "application/x-conference": {
        source: "apache",
        extensions: ["nsc"]
      },
      "application/x-cpio": {
        source: "apache",
        extensions: ["cpio"]
      },
      "application/x-csh": {
        source: "apache",
        extensions: ["csh"]
      },
      "application/x-deb": {
        compressible: false
      },
      "application/x-debian-package": {
        source: "apache",
        extensions: ["deb", "udeb"]
      },
      "application/x-dgc-compressed": {
        source: "apache",
        extensions: ["dgc"]
      },
      "application/x-director": {
        source: "apache",
        extensions: ["dir", "dcr", "dxr", "cst", "cct", "cxt", "w3d", "fgd", "swa"]
      },
      "application/x-doom": {
        source: "apache",
        extensions: ["wad"]
      },
      "application/x-dtbncx+xml": {
        source: "apache",
        compressible: true,
        extensions: ["ncx"]
      },
      "application/x-dtbook+xml": {
        source: "apache",
        compressible: true,
        extensions: ["dtb"]
      },
      "application/x-dtbresource+xml": {
        source: "apache",
        compressible: true,
        extensions: ["res"]
      },
      "application/x-dvi": {
        source: "apache",
        compressible: false,
        extensions: ["dvi"]
      },
      "application/x-envoy": {
        source: "apache",
        extensions: ["evy"]
      },
      "application/x-eva": {
        source: "apache",
        extensions: ["eva"]
      },
      "application/x-font-bdf": {
        source: "apache",
        extensions: ["bdf"]
      },
      "application/x-font-dos": {
        source: "apache"
      },
      "application/x-font-framemaker": {
        source: "apache"
      },
      "application/x-font-ghostscript": {
        source: "apache",
        extensions: ["gsf"]
      },
      "application/x-font-libgrx": {
        source: "apache"
      },
      "application/x-font-linux-psf": {
        source: "apache",
        extensions: ["psf"]
      },
      "application/x-font-pcf": {
        source: "apache",
        extensions: ["pcf"]
      },
      "application/x-font-snf": {
        source: "apache",
        extensions: ["snf"]
      },
      "application/x-font-speedo": {
        source: "apache"
      },
      "application/x-font-sunos-news": {
        source: "apache"
      },
      "application/x-font-type1": {
        source: "apache",
        extensions: ["pfa", "pfb", "pfm", "afm"]
      },
      "application/x-font-vfont": {
        source: "apache"
      },
      "application/x-freearc": {
        source: "apache",
        extensions: ["arc"]
      },
      "application/x-futuresplash": {
        source: "apache",
        extensions: ["spl"]
      },
      "application/x-gca-compressed": {
        source: "apache",
        extensions: ["gca"]
      },
      "application/x-glulx": {
        source: "apache",
        extensions: ["ulx"]
      },
      "application/x-gnumeric": {
        source: "apache",
        extensions: ["gnumeric"]
      },
      "application/x-gramps-xml": {
        source: "apache",
        extensions: ["gramps"]
      },
      "application/x-gtar": {
        source: "apache",
        extensions: ["gtar"]
      },
      "application/x-gzip": {
        source: "apache"
      },
      "application/x-hdf": {
        source: "apache",
        extensions: ["hdf"]
      },
      "application/x-httpd-php": {
        compressible: true,
        extensions: ["php"]
      },
      "application/x-install-instructions": {
        source: "apache",
        extensions: ["install"]
      },
      "application/x-iso9660-image": {
        source: "apache",
        extensions: ["iso"]
      },
      "application/x-iwork-keynote-sffkey": {
        extensions: ["key"]
      },
      "application/x-iwork-numbers-sffnumbers": {
        extensions: ["numbers"]
      },
      "application/x-iwork-pages-sffpages": {
        extensions: ["pages"]
      },
      "application/x-java-archive-diff": {
        source: "nginx",
        extensions: ["jardiff"]
      },
      "application/x-java-jnlp-file": {
        source: "apache",
        compressible: false,
        extensions: ["jnlp"]
      },
      "application/x-javascript": {
        compressible: true
      },
      "application/x-keepass2": {
        extensions: ["kdbx"]
      },
      "application/x-latex": {
        source: "apache",
        compressible: false,
        extensions: ["latex"]
      },
      "application/x-lua-bytecode": {
        extensions: ["luac"]
      },
      "application/x-lzh-compressed": {
        source: "apache",
        extensions: ["lzh", "lha"]
      },
      "application/x-makeself": {
        source: "nginx",
        extensions: ["run"]
      },
      "application/x-mie": {
        source: "apache",
        extensions: ["mie"]
      },
      "application/x-mobipocket-ebook": {
        source: "apache",
        extensions: ["prc", "mobi"]
      },
      "application/x-mpegurl": {
        compressible: false
      },
      "application/x-ms-application": {
        source: "apache",
        extensions: ["application"]
      },
      "application/x-ms-shortcut": {
        source: "apache",
        extensions: ["lnk"]
      },
      "application/x-ms-wmd": {
        source: "apache",
        extensions: ["wmd"]
      },
      "application/x-ms-wmz": {
        source: "apache",
        extensions: ["wmz"]
      },
      "application/x-ms-xbap": {
        source: "apache",
        extensions: ["xbap"]
      },
      "application/x-msaccess": {
        source: "apache",
        extensions: ["mdb"]
      },
      "application/x-msbinder": {
        source: "apache",
        extensions: ["obd"]
      },
      "application/x-mscardfile": {
        source: "apache",
        extensions: ["crd"]
      },
      "application/x-msclip": {
        source: "apache",
        extensions: ["clp"]
      },
      "application/x-msdos-program": {
        extensions: ["exe"]
      },
      "application/x-msdownload": {
        source: "apache",
        extensions: ["exe", "dll", "com", "bat", "msi"]
      },
      "application/x-msmediaview": {
        source: "apache",
        extensions: ["mvb", "m13", "m14"]
      },
      "application/x-msmetafile": {
        source: "apache",
        extensions: ["wmf", "wmz", "emf", "emz"]
      },
      "application/x-msmoney": {
        source: "apache",
        extensions: ["mny"]
      },
      "application/x-mspublisher": {
        source: "apache",
        extensions: ["pub"]
      },
      "application/x-msschedule": {
        source: "apache",
        extensions: ["scd"]
      },
      "application/x-msterminal": {
        source: "apache",
        extensions: ["trm"]
      },
      "application/x-mswrite": {
        source: "apache",
        extensions: ["wri"]
      },
      "application/x-netcdf": {
        source: "apache",
        extensions: ["nc", "cdf"]
      },
      "application/x-ns-proxy-autoconfig": {
        compressible: true,
        extensions: ["pac"]
      },
      "application/x-nzb": {
        source: "apache",
        extensions: ["nzb"]
      },
      "application/x-perl": {
        source: "nginx",
        extensions: ["pl", "pm"]
      },
      "application/x-pilot": {
        source: "nginx",
        extensions: ["prc", "pdb"]
      },
      "application/x-pkcs12": {
        source: "apache",
        compressible: false,
        extensions: ["p12", "pfx"]
      },
      "application/x-pkcs7-certificates": {
        source: "apache",
        extensions: ["p7b", "spc"]
      },
      "application/x-pkcs7-certreqresp": {
        source: "apache",
        extensions: ["p7r"]
      },
      "application/x-pki-message": {
        source: "iana"
      },
      "application/x-rar-compressed": {
        source: "apache",
        compressible: false,
        extensions: ["rar"]
      },
      "application/x-redhat-package-manager": {
        source: "nginx",
        extensions: ["rpm"]
      },
      "application/x-research-info-systems": {
        source: "apache",
        extensions: ["ris"]
      },
      "application/x-sea": {
        source: "nginx",
        extensions: ["sea"]
      },
      "application/x-sh": {
        source: "apache",
        compressible: true,
        extensions: ["sh"]
      },
      "application/x-shar": {
        source: "apache",
        extensions: ["shar"]
      },
      "application/x-shockwave-flash": {
        source: "apache",
        compressible: false,
        extensions: ["swf"]
      },
      "application/x-silverlight-app": {
        source: "apache",
        extensions: ["xap"]
      },
      "application/x-sql": {
        source: "apache",
        extensions: ["sql"]
      },
      "application/x-stuffit": {
        source: "apache",
        compressible: false,
        extensions: ["sit"]
      },
      "application/x-stuffitx": {
        source: "apache",
        extensions: ["sitx"]
      },
      "application/x-subrip": {
        source: "apache",
        extensions: ["srt"]
      },
      "application/x-sv4cpio": {
        source: "apache",
        extensions: ["sv4cpio"]
      },
      "application/x-sv4crc": {
        source: "apache",
        extensions: ["sv4crc"]
      },
      "application/x-t3vm-image": {
        source: "apache",
        extensions: ["t3"]
      },
      "application/x-tads": {
        source: "apache",
        extensions: ["gam"]
      },
      "application/x-tar": {
        source: "apache",
        compressible: true,
        extensions: ["tar"]
      },
      "application/x-tcl": {
        source: "apache",
        extensions: ["tcl", "tk"]
      },
      "application/x-tex": {
        source: "apache",
        extensions: ["tex"]
      },
      "application/x-tex-tfm": {
        source: "apache",
        extensions: ["tfm"]
      },
      "application/x-texinfo": {
        source: "apache",
        extensions: ["texinfo", "texi"]
      },
      "application/x-tgif": {
        source: "apache",
        extensions: ["obj"]
      },
      "application/x-ustar": {
        source: "apache",
        extensions: ["ustar"]
      },
      "application/x-virtualbox-hdd": {
        compressible: true,
        extensions: ["hdd"]
      },
      "application/x-virtualbox-ova": {
        compressible: true,
        extensions: ["ova"]
      },
      "application/x-virtualbox-ovf": {
        compressible: true,
        extensions: ["ovf"]
      },
      "application/x-virtualbox-vbox": {
        compressible: true,
        extensions: ["vbox"]
      },
      "application/x-virtualbox-vbox-extpack": {
        compressible: false,
        extensions: ["vbox-extpack"]
      },
      "application/x-virtualbox-vdi": {
        compressible: true,
        extensions: ["vdi"]
      },
      "application/x-virtualbox-vhd": {
        compressible: true,
        extensions: ["vhd"]
      },
      "application/x-virtualbox-vmdk": {
        compressible: true,
        extensions: ["vmdk"]
      },
      "application/x-wais-source": {
        source: "apache",
        extensions: ["src"]
      },
      "application/x-web-app-manifest+json": {
        compressible: true,
        extensions: ["webapp"]
      },
      "application/x-www-form-urlencoded": {
        source: "iana",
        compressible: true
      },
      "application/x-x509-ca-cert": {
        source: "iana",
        extensions: ["der", "crt", "pem"]
      },
      "application/x-x509-ca-ra-cert": {
        source: "iana"
      },
      "application/x-x509-next-ca-cert": {
        source: "iana"
      },
      "application/x-xfig": {
        source: "apache",
        extensions: ["fig"]
      },
      "application/x-xliff+xml": {
        source: "apache",
        compressible: true,
        extensions: ["xlf"]
      },
      "application/x-xpinstall": {
        source: "apache",
        compressible: false,
        extensions: ["xpi"]
      },
      "application/x-xz": {
        source: "apache",
        extensions: ["xz"]
      },
      "application/x-zmachine": {
        source: "apache",
        extensions: ["z1", "z2", "z3", "z4", "z5", "z6", "z7", "z8"]
      },
      "application/x400-bp": {
        source: "iana"
      },
      "application/xacml+xml": {
        source: "iana",
        compressible: true
      },
      "application/xaml+xml": {
        source: "apache",
        compressible: true,
        extensions: ["xaml"]
      },
      "application/xcap-att+xml": {
        source: "iana",
        compressible: true,
        extensions: ["xav"]
      },
      "application/xcap-caps+xml": {
        source: "iana",
        compressible: true,
        extensions: ["xca"]
      },
      "application/xcap-diff+xml": {
        source: "iana",
        compressible: true,
        extensions: ["xdf"]
      },
      "application/xcap-el+xml": {
        source: "iana",
        compressible: true,
        extensions: ["xel"]
      },
      "application/xcap-error+xml": {
        source: "iana",
        compressible: true
      },
      "application/xcap-ns+xml": {
        source: "iana",
        compressible: true,
        extensions: ["xns"]
      },
      "application/xcon-conference-info+xml": {
        source: "iana",
        compressible: true
      },
      "application/xcon-conference-info-diff+xml": {
        source: "iana",
        compressible: true
      },
      "application/xenc+xml": {
        source: "iana",
        compressible: true,
        extensions: ["xenc"]
      },
      "application/xhtml+xml": {
        source: "iana",
        compressible: true,
        extensions: ["xhtml", "xht"]
      },
      "application/xhtml-voice+xml": {
        source: "apache",
        compressible: true
      },
      "application/xliff+xml": {
        source: "iana",
        compressible: true,
        extensions: ["xlf"]
      },
      "application/xml": {
        source: "iana",
        compressible: true,
        extensions: ["xml", "xsl", "xsd", "rng"]
      },
      "application/xml-dtd": {
        source: "iana",
        compressible: true,
        extensions: ["dtd"]
      },
      "application/xml-external-parsed-entity": {
        source: "iana"
      },
      "application/xml-patch+xml": {
        source: "iana",
        compressible: true
      },
      "application/xmpp+xml": {
        source: "iana",
        compressible: true
      },
      "application/xop+xml": {
        source: "iana",
        compressible: true,
        extensions: ["xop"]
      },
      "application/xproc+xml": {
        source: "apache",
        compressible: true,
        extensions: ["xpl"]
      },
      "application/xslt+xml": {
        source: "iana",
        compressible: true,
        extensions: ["xsl", "xslt"]
      },
      "application/xspf+xml": {
        source: "apache",
        compressible: true,
        extensions: ["xspf"]
      },
      "application/xv+xml": {
        source: "iana",
        compressible: true,
        extensions: ["mxml", "xhvml", "xvml", "xvm"]
      },
      "application/yang": {
        source: "iana",
        extensions: ["yang"]
      },
      "application/yang-data+json": {
        source: "iana",
        compressible: true
      },
      "application/yang-data+xml": {
        source: "iana",
        compressible: true
      },
      "application/yang-patch+json": {
        source: "iana",
        compressible: true
      },
      "application/yang-patch+xml": {
        source: "iana",
        compressible: true
      },
      "application/yin+xml": {
        source: "iana",
        compressible: true,
        extensions: ["yin"]
      },
      "application/zip": {
        source: "iana",
        compressible: false,
        extensions: ["zip"]
      },
      "application/zlib": {
        source: "iana"
      },
      "application/zstd": {
        source: "iana"
      },
      "audio/1d-interleaved-parityfec": {
        source: "iana"
      },
      "audio/32kadpcm": {
        source: "iana"
      },
      "audio/3gpp": {
        source: "iana",
        compressible: false,
        extensions: ["3gpp"]
      },
      "audio/3gpp2": {
        source: "iana"
      },
      "audio/aac": {
        source: "iana"
      },
      "audio/ac3": {
        source: "iana"
      },
      "audio/adpcm": {
        source: "apache",
        extensions: ["adp"]
      },
      "audio/amr": {
        source: "iana",
        extensions: ["amr"]
      },
      "audio/amr-wb": {
        source: "iana"
      },
      "audio/amr-wb+": {
        source: "iana"
      },
      "audio/aptx": {
        source: "iana"
      },
      "audio/asc": {
        source: "iana"
      },
      "audio/atrac-advanced-lossless": {
        source: "iana"
      },
      "audio/atrac-x": {
        source: "iana"
      },
      "audio/atrac3": {
        source: "iana"
      },
      "audio/basic": {
        source: "iana",
        compressible: false,
        extensions: ["au", "snd"]
      },
      "audio/bv16": {
        source: "iana"
      },
      "audio/bv32": {
        source: "iana"
      },
      "audio/clearmode": {
        source: "iana"
      },
      "audio/cn": {
        source: "iana"
      },
      "audio/dat12": {
        source: "iana"
      },
      "audio/dls": {
        source: "iana"
      },
      "audio/dsr-es201108": {
        source: "iana"
      },
      "audio/dsr-es202050": {
        source: "iana"
      },
      "audio/dsr-es202211": {
        source: "iana"
      },
      "audio/dsr-es202212": {
        source: "iana"
      },
      "audio/dv": {
        source: "iana"
      },
      "audio/dvi4": {
        source: "iana"
      },
      "audio/eac3": {
        source: "iana"
      },
      "audio/encaprtp": {
        source: "iana"
      },
      "audio/evrc": {
        source: "iana"
      },
      "audio/evrc-qcp": {
        source: "iana"
      },
      "audio/evrc0": {
        source: "iana"
      },
      "audio/evrc1": {
        source: "iana"
      },
      "audio/evrcb": {
        source: "iana"
      },
      "audio/evrcb0": {
        source: "iana"
      },
      "audio/evrcb1": {
        source: "iana"
      },
      "audio/evrcnw": {
        source: "iana"
      },
      "audio/evrcnw0": {
        source: "iana"
      },
      "audio/evrcnw1": {
        source: "iana"
      },
      "audio/evrcwb": {
        source: "iana"
      },
      "audio/evrcwb0": {
        source: "iana"
      },
      "audio/evrcwb1": {
        source: "iana"
      },
      "audio/evs": {
        source: "iana"
      },
      "audio/flexfec": {
        source: "iana"
      },
      "audio/fwdred": {
        source: "iana"
      },
      "audio/g711-0": {
        source: "iana"
      },
      "audio/g719": {
        source: "iana"
      },
      "audio/g722": {
        source: "iana"
      },
      "audio/g7221": {
        source: "iana"
      },
      "audio/g723": {
        source: "iana"
      },
      "audio/g726-16": {
        source: "iana"
      },
      "audio/g726-24": {
        source: "iana"
      },
      "audio/g726-32": {
        source: "iana"
      },
      "audio/g726-40": {
        source: "iana"
      },
      "audio/g728": {
        source: "iana"
      },
      "audio/g729": {
        source: "iana"
      },
      "audio/g7291": {
        source: "iana"
      },
      "audio/g729d": {
        source: "iana"
      },
      "audio/g729e": {
        source: "iana"
      },
      "audio/gsm": {
        source: "iana"
      },
      "audio/gsm-efr": {
        source: "iana"
      },
      "audio/gsm-hr-08": {
        source: "iana"
      },
      "audio/ilbc": {
        source: "iana"
      },
      "audio/ip-mr_v2.5": {
        source: "iana"
      },
      "audio/isac": {
        source: "apache"
      },
      "audio/l16": {
        source: "iana"
      },
      "audio/l20": {
        source: "iana"
      },
      "audio/l24": {
        source: "iana",
        compressible: false
      },
      "audio/l8": {
        source: "iana"
      },
      "audio/lpc": {
        source: "iana"
      },
      "audio/melp": {
        source: "iana"
      },
      "audio/melp1200": {
        source: "iana"
      },
      "audio/melp2400": {
        source: "iana"
      },
      "audio/melp600": {
        source: "iana"
      },
      "audio/mhas": {
        source: "iana"
      },
      "audio/midi": {
        source: "apache",
        extensions: ["mid", "midi", "kar", "rmi"]
      },
      "audio/mobile-xmf": {
        source: "iana",
        extensions: ["mxmf"]
      },
      "audio/mp3": {
        compressible: false,
        extensions: ["mp3"]
      },
      "audio/mp4": {
        source: "iana",
        compressible: false,
        extensions: ["m4a", "mp4a"]
      },
      "audio/mp4a-latm": {
        source: "iana"
      },
      "audio/mpa": {
        source: "iana"
      },
      "audio/mpa-robust": {
        source: "iana"
      },
      "audio/mpeg": {
        source: "iana",
        compressible: false,
        extensions: ["mpga", "mp2", "mp2a", "mp3", "m2a", "m3a"]
      },
      "audio/mpeg4-generic": {
        source: "iana"
      },
      "audio/musepack": {
        source: "apache"
      },
      "audio/ogg": {
        source: "iana",
        compressible: false,
        extensions: ["oga", "ogg", "spx", "opus"]
      },
      "audio/opus": {
        source: "iana"
      },
      "audio/parityfec": {
        source: "iana"
      },
      "audio/pcma": {
        source: "iana"
      },
      "audio/pcma-wb": {
        source: "iana"
      },
      "audio/pcmu": {
        source: "iana"
      },
      "audio/pcmu-wb": {
        source: "iana"
      },
      "audio/prs.sid": {
        source: "iana"
      },
      "audio/qcelp": {
        source: "iana"
      },
      "audio/raptorfec": {
        source: "iana"
      },
      "audio/red": {
        source: "iana"
      },
      "audio/rtp-enc-aescm128": {
        source: "iana"
      },
      "audio/rtp-midi": {
        source: "iana"
      },
      "audio/rtploopback": {
        source: "iana"
      },
      "audio/rtx": {
        source: "iana"
      },
      "audio/s3m": {
        source: "apache",
        extensions: ["s3m"]
      },
      "audio/scip": {
        source: "iana"
      },
      "audio/silk": {
        source: "apache",
        extensions: ["sil"]
      },
      "audio/smv": {
        source: "iana"
      },
      "audio/smv-qcp": {
        source: "iana"
      },
      "audio/smv0": {
        source: "iana"
      },
      "audio/sofa": {
        source: "iana"
      },
      "audio/sp-midi": {
        source: "iana"
      },
      "audio/speex": {
        source: "iana"
      },
      "audio/t140c": {
        source: "iana"
      },
      "audio/t38": {
        source: "iana"
      },
      "audio/telephone-event": {
        source: "iana"
      },
      "audio/tetra_acelp": {
        source: "iana"
      },
      "audio/tetra_acelp_bb": {
        source: "iana"
      },
      "audio/tone": {
        source: "iana"
      },
      "audio/tsvcis": {
        source: "iana"
      },
      "audio/uemclip": {
        source: "iana"
      },
      "audio/ulpfec": {
        source: "iana"
      },
      "audio/usac": {
        source: "iana"
      },
      "audio/vdvi": {
        source: "iana"
      },
      "audio/vmr-wb": {
        source: "iana"
      },
      "audio/vnd.3gpp.iufp": {
        source: "iana"
      },
      "audio/vnd.4sb": {
        source: "iana"
      },
      "audio/vnd.audiokoz": {
        source: "iana"
      },
      "audio/vnd.celp": {
        source: "iana"
      },
      "audio/vnd.cisco.nse": {
        source: "iana"
      },
      "audio/vnd.cmles.radio-events": {
        source: "iana"
      },
      "audio/vnd.cns.anp1": {
        source: "iana"
      },
      "audio/vnd.cns.inf1": {
        source: "iana"
      },
      "audio/vnd.dece.audio": {
        source: "iana",
        extensions: ["uva", "uvva"]
      },
      "audio/vnd.digital-winds": {
        source: "iana",
        extensions: ["eol"]
      },
      "audio/vnd.dlna.adts": {
        source: "iana"
      },
      "audio/vnd.dolby.heaac.1": {
        source: "iana"
      },
      "audio/vnd.dolby.heaac.2": {
        source: "iana"
      },
      "audio/vnd.dolby.mlp": {
        source: "iana"
      },
      "audio/vnd.dolby.mps": {
        source: "iana"
      },
      "audio/vnd.dolby.pl2": {
        source: "iana"
      },
      "audio/vnd.dolby.pl2x": {
        source: "iana"
      },
      "audio/vnd.dolby.pl2z": {
        source: "iana"
      },
      "audio/vnd.dolby.pulse.1": {
        source: "iana"
      },
      "audio/vnd.dra": {
        source: "iana",
        extensions: ["dra"]
      },
      "audio/vnd.dts": {
        source: "iana",
        extensions: ["dts"]
      },
      "audio/vnd.dts.hd": {
        source: "iana",
        extensions: ["dtshd"]
      },
      "audio/vnd.dts.uhd": {
        source: "iana"
      },
      "audio/vnd.dvb.file": {
        source: "iana"
      },
      "audio/vnd.everad.plj": {
        source: "iana"
      },
      "audio/vnd.hns.audio": {
        source: "iana"
      },
      "audio/vnd.lucent.voice": {
        source: "iana",
        extensions: ["lvp"]
      },
      "audio/vnd.ms-playready.media.pya": {
        source: "iana",
        extensions: ["pya"]
      },
      "audio/vnd.nokia.mobile-xmf": {
        source: "iana"
      },
      "audio/vnd.nortel.vbk": {
        source: "iana"
      },
      "audio/vnd.nuera.ecelp4800": {
        source: "iana",
        extensions: ["ecelp4800"]
      },
      "audio/vnd.nuera.ecelp7470": {
        source: "iana",
        extensions: ["ecelp7470"]
      },
      "audio/vnd.nuera.ecelp9600": {
        source: "iana",
        extensions: ["ecelp9600"]
      },
      "audio/vnd.octel.sbc": {
        source: "iana"
      },
      "audio/vnd.presonus.multitrack": {
        source: "iana"
      },
      "audio/vnd.qcelp": {
        source: "iana"
      },
      "audio/vnd.rhetorex.32kadpcm": {
        source: "iana"
      },
      "audio/vnd.rip": {
        source: "iana",
        extensions: ["rip"]
      },
      "audio/vnd.rn-realaudio": {
        compressible: false
      },
      "audio/vnd.sealedmedia.softseal.mpeg": {
        source: "iana"
      },
      "audio/vnd.vmx.cvsd": {
        source: "iana"
      },
      "audio/vnd.wave": {
        compressible: false
      },
      "audio/vorbis": {
        source: "iana",
        compressible: false
      },
      "audio/vorbis-config": {
        source: "iana"
      },
      "audio/wav": {
        compressible: false,
        extensions: ["wav"]
      },
      "audio/wave": {
        compressible: false,
        extensions: ["wav"]
      },
      "audio/webm": {
        source: "apache",
        compressible: false,
        extensions: ["weba"]
      },
      "audio/x-aac": {
        source: "apache",
        compressible: false,
        extensions: ["aac"]
      },
      "audio/x-aiff": {
        source: "apache",
        extensions: ["aif", "aiff", "aifc"]
      },
      "audio/x-caf": {
        source: "apache",
        compressible: false,
        extensions: ["caf"]
      },
      "audio/x-flac": {
        source: "apache",
        extensions: ["flac"]
      },
      "audio/x-m4a": {
        source: "nginx",
        extensions: ["m4a"]
      },
      "audio/x-matroska": {
        source: "apache",
        extensions: ["mka"]
      },
      "audio/x-mpegurl": {
        source: "apache",
        extensions: ["m3u"]
      },
      "audio/x-ms-wax": {
        source: "apache",
        extensions: ["wax"]
      },
      "audio/x-ms-wma": {
        source: "apache",
        extensions: ["wma"]
      },
      "audio/x-pn-realaudio": {
        source: "apache",
        extensions: ["ram", "ra"]
      },
      "audio/x-pn-realaudio-plugin": {
        source: "apache",
        extensions: ["rmp"]
      },
      "audio/x-realaudio": {
        source: "nginx",
        extensions: ["ra"]
      },
      "audio/x-tta": {
        source: "apache"
      },
      "audio/x-wav": {
        source: "apache",
        extensions: ["wav"]
      },
      "audio/xm": {
        source: "apache",
        extensions: ["xm"]
      },
      "chemical/x-cdx": {
        source: "apache",
        extensions: ["cdx"]
      },
      "chemical/x-cif": {
        source: "apache",
        extensions: ["cif"]
      },
      "chemical/x-cmdf": {
        source: "apache",
        extensions: ["cmdf"]
      },
      "chemical/x-cml": {
        source: "apache",
        extensions: ["cml"]
      },
      "chemical/x-csml": {
        source: "apache",
        extensions: ["csml"]
      },
      "chemical/x-pdb": {
        source: "apache"
      },
      "chemical/x-xyz": {
        source: "apache",
        extensions: ["xyz"]
      },
      "font/collection": {
        source: "iana",
        extensions: ["ttc"]
      },
      "font/otf": {
        source: "iana",
        compressible: true,
        extensions: ["otf"]
      },
      "font/sfnt": {
        source: "iana"
      },
      "font/ttf": {
        source: "iana",
        compressible: true,
        extensions: ["ttf"]
      },
      "font/woff": {
        source: "iana",
        extensions: ["woff"]
      },
      "font/woff2": {
        source: "iana",
        extensions: ["woff2"]
      },
      "image/aces": {
        source: "iana",
        extensions: ["exr"]
      },
      "image/apng": {
        compressible: false,
        extensions: ["apng"]
      },
      "image/avci": {
        source: "iana",
        extensions: ["avci"]
      },
      "image/avcs": {
        source: "iana",
        extensions: ["avcs"]
      },
      "image/avif": {
        source: "iana",
        compressible: false,
        extensions: ["avif"]
      },
      "image/bmp": {
        source: "iana",
        compressible: true,
        extensions: ["bmp"]
      },
      "image/cgm": {
        source: "iana",
        extensions: ["cgm"]
      },
      "image/dicom-rle": {
        source: "iana",
        extensions: ["drle"]
      },
      "image/emf": {
        source: "iana",
        extensions: ["emf"]
      },
      "image/fits": {
        source: "iana",
        extensions: ["fits"]
      },
      "image/g3fax": {
        source: "iana",
        extensions: ["g3"]
      },
      "image/gif": {
        source: "iana",
        compressible: false,
        extensions: ["gif"]
      },
      "image/heic": {
        source: "iana",
        extensions: ["heic"]
      },
      "image/heic-sequence": {
        source: "iana",
        extensions: ["heics"]
      },
      "image/heif": {
        source: "iana",
        extensions: ["heif"]
      },
      "image/heif-sequence": {
        source: "iana",
        extensions: ["heifs"]
      },
      "image/hej2k": {
        source: "iana",
        extensions: ["hej2"]
      },
      "image/hsj2": {
        source: "iana",
        extensions: ["hsj2"]
      },
      "image/ief": {
        source: "iana",
        extensions: ["ief"]
      },
      "image/jls": {
        source: "iana",
        extensions: ["jls"]
      },
      "image/jp2": {
        source: "iana",
        compressible: false,
        extensions: ["jp2", "jpg2"]
      },
      "image/jpeg": {
        source: "iana",
        compressible: false,
        extensions: ["jpeg", "jpg", "jpe"]
      },
      "image/jph": {
        source: "iana",
        extensions: ["jph"]
      },
      "image/jphc": {
        source: "iana",
        extensions: ["jhc"]
      },
      "image/jpm": {
        source: "iana",
        compressible: false,
        extensions: ["jpm"]
      },
      "image/jpx": {
        source: "iana",
        compressible: false,
        extensions: ["jpx", "jpf"]
      },
      "image/jxr": {
        source: "iana",
        extensions: ["jxr"]
      },
      "image/jxra": {
        source: "iana",
        extensions: ["jxra"]
      },
      "image/jxrs": {
        source: "iana",
        extensions: ["jxrs"]
      },
      "image/jxs": {
        source: "iana",
        extensions: ["jxs"]
      },
      "image/jxsc": {
        source: "iana",
        extensions: ["jxsc"]
      },
      "image/jxsi": {
        source: "iana",
        extensions: ["jxsi"]
      },
      "image/jxss": {
        source: "iana",
        extensions: ["jxss"]
      },
      "image/ktx": {
        source: "iana",
        extensions: ["ktx"]
      },
      "image/ktx2": {
        source: "iana",
        extensions: ["ktx2"]
      },
      "image/naplps": {
        source: "iana"
      },
      "image/pjpeg": {
        compressible: false
      },
      "image/png": {
        source: "iana",
        compressible: false,
        extensions: ["png"]
      },
      "image/prs.btif": {
        source: "iana",
        extensions: ["btif"]
      },
      "image/prs.pti": {
        source: "iana",
        extensions: ["pti"]
      },
      "image/pwg-raster": {
        source: "iana"
      },
      "image/sgi": {
        source: "apache",
        extensions: ["sgi"]
      },
      "image/svg+xml": {
        source: "iana",
        compressible: true,
        extensions: ["svg", "svgz"]
      },
      "image/t38": {
        source: "iana",
        extensions: ["t38"]
      },
      "image/tiff": {
        source: "iana",
        compressible: false,
        extensions: ["tif", "tiff"]
      },
      "image/tiff-fx": {
        source: "iana",
        extensions: ["tfx"]
      },
      "image/vnd.adobe.photoshop": {
        source: "iana",
        compressible: true,
        extensions: ["psd"]
      },
      "image/vnd.airzip.accelerator.azv": {
        source: "iana",
        extensions: ["azv"]
      },
      "image/vnd.cns.inf2": {
        source: "iana"
      },
      "image/vnd.dece.graphic": {
        source: "iana",
        extensions: ["uvi", "uvvi", "uvg", "uvvg"]
      },
      "image/vnd.djvu": {
        source: "iana",
        extensions: ["djvu", "djv"]
      },
      "image/vnd.dvb.subtitle": {
        source: "iana",
        extensions: ["sub"]
      },
      "image/vnd.dwg": {
        source: "iana",
        extensions: ["dwg"]
      },
      "image/vnd.dxf": {
        source: "iana",
        extensions: ["dxf"]
      },
      "image/vnd.fastbidsheet": {
        source: "iana",
        extensions: ["fbs"]
      },
      "image/vnd.fpx": {
        source: "iana",
        extensions: ["fpx"]
      },
      "image/vnd.fst": {
        source: "iana",
        extensions: ["fst"]
      },
      "image/vnd.fujixerox.edmics-mmr": {
        source: "iana",
        extensions: ["mmr"]
      },
      "image/vnd.fujixerox.edmics-rlc": {
        source: "iana",
        extensions: ["rlc"]
      },
      "image/vnd.globalgraphics.pgb": {
        source: "iana"
      },
      "image/vnd.microsoft.icon": {
        source: "iana",
        compressible: true,
        extensions: ["ico"]
      },
      "image/vnd.mix": {
        source: "iana"
      },
      "image/vnd.mozilla.apng": {
        source: "iana"
      },
      "image/vnd.ms-dds": {
        compressible: true,
        extensions: ["dds"]
      },
      "image/vnd.ms-modi": {
        source: "iana",
        extensions: ["mdi"]
      },
      "image/vnd.ms-photo": {
        source: "apache",
        extensions: ["wdp"]
      },
      "image/vnd.net-fpx": {
        source: "iana",
        extensions: ["npx"]
      },
      "image/vnd.pco.b16": {
        source: "iana",
        extensions: ["b16"]
      },
      "image/vnd.radiance": {
        source: "iana"
      },
      "image/vnd.sealed.png": {
        source: "iana"
      },
      "image/vnd.sealedmedia.softseal.gif": {
        source: "iana"
      },
      "image/vnd.sealedmedia.softseal.jpg": {
        source: "iana"
      },
      "image/vnd.svf": {
        source: "iana"
      },
      "image/vnd.tencent.tap": {
        source: "iana",
        extensions: ["tap"]
      },
      "image/vnd.valve.source.texture": {
        source: "iana",
        extensions: ["vtf"]
      },
      "image/vnd.wap.wbmp": {
        source: "iana",
        extensions: ["wbmp"]
      },
      "image/vnd.xiff": {
        source: "iana",
        extensions: ["xif"]
      },
      "image/vnd.zbrush.pcx": {
        source: "iana",
        extensions: ["pcx"]
      },
      "image/webp": {
        source: "apache",
        extensions: ["webp"]
      },
      "image/wmf": {
        source: "iana",
        extensions: ["wmf"]
      },
      "image/x-3ds": {
        source: "apache",
        extensions: ["3ds"]
      },
      "image/x-cmu-raster": {
        source: "apache",
        extensions: ["ras"]
      },
      "image/x-cmx": {
        source: "apache",
        extensions: ["cmx"]
      },
      "image/x-freehand": {
        source: "apache",
        extensions: ["fh", "fhc", "fh4", "fh5", "fh7"]
      },
      "image/x-icon": {
        source: "apache",
        compressible: true,
        extensions: ["ico"]
      },
      "image/x-jng": {
        source: "nginx",
        extensions: ["jng"]
      },
      "image/x-mrsid-image": {
        source: "apache",
        extensions: ["sid"]
      },
      "image/x-ms-bmp": {
        source: "nginx",
        compressible: true,
        extensions: ["bmp"]
      },
      "image/x-pcx": {
        source: "apache",
        extensions: ["pcx"]
      },
      "image/x-pict": {
        source: "apache",
        extensions: ["pic", "pct"]
      },
      "image/x-portable-anymap": {
        source: "apache",
        extensions: ["pnm"]
      },
      "image/x-portable-bitmap": {
        source: "apache",
        extensions: ["pbm"]
      },
      "image/x-portable-graymap": {
        source: "apache",
        extensions: ["pgm"]
      },
      "image/x-portable-pixmap": {
        source: "apache",
        extensions: ["ppm"]
      },
      "image/x-rgb": {
        source: "apache",
        extensions: ["rgb"]
      },
      "image/x-tga": {
        source: "apache",
        extensions: ["tga"]
      },
      "image/x-xbitmap": {
        source: "apache",
        extensions: ["xbm"]
      },
      "image/x-xcf": {
        compressible: false
      },
      "image/x-xpixmap": {
        source: "apache",
        extensions: ["xpm"]
      },
      "image/x-xwindowdump": {
        source: "apache",
        extensions: ["xwd"]
      },
      "message/cpim": {
        source: "iana"
      },
      "message/delivery-status": {
        source: "iana"
      },
      "message/disposition-notification": {
        source: "iana",
        extensions: [
          "disposition-notification"
        ]
      },
      "message/external-body": {
        source: "iana"
      },
      "message/feedback-report": {
        source: "iana"
      },
      "message/global": {
        source: "iana",
        extensions: ["u8msg"]
      },
      "message/global-delivery-status": {
        source: "iana",
        extensions: ["u8dsn"]
      },
      "message/global-disposition-notification": {
        source: "iana",
        extensions: ["u8mdn"]
      },
      "message/global-headers": {
        source: "iana",
        extensions: ["u8hdr"]
      },
      "message/http": {
        source: "iana",
        compressible: false
      },
      "message/imdn+xml": {
        source: "iana",
        compressible: true
      },
      "message/news": {
        source: "iana"
      },
      "message/partial": {
        source: "iana",
        compressible: false
      },
      "message/rfc822": {
        source: "iana",
        compressible: true,
        extensions: ["eml", "mime"]
      },
      "message/s-http": {
        source: "iana"
      },
      "message/sip": {
        source: "iana"
      },
      "message/sipfrag": {
        source: "iana"
      },
      "message/tracking-status": {
        source: "iana"
      },
      "message/vnd.si.simp": {
        source: "iana"
      },
      "message/vnd.wfa.wsc": {
        source: "iana",
        extensions: ["wsc"]
      },
      "model/3mf": {
        source: "iana",
        extensions: ["3mf"]
      },
      "model/e57": {
        source: "iana"
      },
      "model/gltf+json": {
        source: "iana",
        compressible: true,
        extensions: ["gltf"]
      },
      "model/gltf-binary": {
        source: "iana",
        compressible: true,
        extensions: ["glb"]
      },
      "model/iges": {
        source: "iana",
        compressible: false,
        extensions: ["igs", "iges"]
      },
      "model/mesh": {
        source: "iana",
        compressible: false,
        extensions: ["msh", "mesh", "silo"]
      },
      "model/mtl": {
        source: "iana",
        extensions: ["mtl"]
      },
      "model/obj": {
        source: "iana",
        extensions: ["obj"]
      },
      "model/step": {
        source: "iana"
      },
      "model/step+xml": {
        source: "iana",
        compressible: true,
        extensions: ["stpx"]
      },
      "model/step+zip": {
        source: "iana",
        compressible: false,
        extensions: ["stpz"]
      },
      "model/step-xml+zip": {
        source: "iana",
        compressible: false,
        extensions: ["stpxz"]
      },
      "model/stl": {
        source: "iana",
        extensions: ["stl"]
      },
      "model/vnd.collada+xml": {
        source: "iana",
        compressible: true,
        extensions: ["dae"]
      },
      "model/vnd.dwf": {
        source: "iana",
        extensions: ["dwf"]
      },
      "model/vnd.flatland.3dml": {
        source: "iana"
      },
      "model/vnd.gdl": {
        source: "iana",
        extensions: ["gdl"]
      },
      "model/vnd.gs-gdl": {
        source: "apache"
      },
      "model/vnd.gs.gdl": {
        source: "iana"
      },
      "model/vnd.gtw": {
        source: "iana",
        extensions: ["gtw"]
      },
      "model/vnd.moml+xml": {
        source: "iana",
        compressible: true
      },
      "model/vnd.mts": {
        source: "iana",
        extensions: ["mts"]
      },
      "model/vnd.opengex": {
        source: "iana",
        extensions: ["ogex"]
      },
      "model/vnd.parasolid.transmit.binary": {
        source: "iana",
        extensions: ["x_b"]
      },
      "model/vnd.parasolid.transmit.text": {
        source: "iana",
        extensions: ["x_t"]
      },
      "model/vnd.pytha.pyox": {
        source: "iana"
      },
      "model/vnd.rosette.annotated-data-model": {
        source: "iana"
      },
      "model/vnd.sap.vds": {
        source: "iana",
        extensions: ["vds"]
      },
      "model/vnd.usdz+zip": {
        source: "iana",
        compressible: false,
        extensions: ["usdz"]
      },
      "model/vnd.valve.source.compiled-map": {
        source: "iana",
        extensions: ["bsp"]
      },
      "model/vnd.vtu": {
        source: "iana",
        extensions: ["vtu"]
      },
      "model/vrml": {
        source: "iana",
        compressible: false,
        extensions: ["wrl", "vrml"]
      },
      "model/x3d+binary": {
        source: "apache",
        compressible: false,
        extensions: ["x3db", "x3dbz"]
      },
      "model/x3d+fastinfoset": {
        source: "iana",
        extensions: ["x3db"]
      },
      "model/x3d+vrml": {
        source: "apache",
        compressible: false,
        extensions: ["x3dv", "x3dvz"]
      },
      "model/x3d+xml": {
        source: "iana",
        compressible: true,
        extensions: ["x3d", "x3dz"]
      },
      "model/x3d-vrml": {
        source: "iana",
        extensions: ["x3dv"]
      },
      "multipart/alternative": {
        source: "iana",
        compressible: false
      },
      "multipart/appledouble": {
        source: "iana"
      },
      "multipart/byteranges": {
        source: "iana"
      },
      "multipart/digest": {
        source: "iana"
      },
      "multipart/encrypted": {
        source: "iana",
        compressible: false
      },
      "multipart/form-data": {
        source: "iana",
        compressible: false
      },
      "multipart/header-set": {
        source: "iana"
      },
      "multipart/mixed": {
        source: "iana"
      },
      "multipart/multilingual": {
        source: "iana"
      },
      "multipart/parallel": {
        source: "iana"
      },
      "multipart/related": {
        source: "iana",
        compressible: false
      },
      "multipart/report": {
        source: "iana"
      },
      "multipart/signed": {
        source: "iana",
        compressible: false
      },
      "multipart/vnd.bint.med-plus": {
        source: "iana"
      },
      "multipart/voice-message": {
        source: "iana"
      },
      "multipart/x-mixed-replace": {
        source: "iana"
      },
      "text/1d-interleaved-parityfec": {
        source: "iana"
      },
      "text/cache-manifest": {
        source: "iana",
        compressible: true,
        extensions: ["appcache", "manifest"]
      },
      "text/calendar": {
        source: "iana",
        extensions: ["ics", "ifb"]
      },
      "text/calender": {
        compressible: true
      },
      "text/cmd": {
        compressible: true
      },
      "text/coffeescript": {
        extensions: ["coffee", "litcoffee"]
      },
      "text/cql": {
        source: "iana"
      },
      "text/cql-expression": {
        source: "iana"
      },
      "text/cql-identifier": {
        source: "iana"
      },
      "text/css": {
        source: "iana",
        charset: "UTF-8",
        compressible: true,
        extensions: ["css"]
      },
      "text/csv": {
        source: "iana",
        compressible: true,
        extensions: ["csv"]
      },
      "text/csv-schema": {
        source: "iana"
      },
      "text/directory": {
        source: "iana"
      },
      "text/dns": {
        source: "iana"
      },
      "text/ecmascript": {
        source: "iana"
      },
      "text/encaprtp": {
        source: "iana"
      },
      "text/enriched": {
        source: "iana"
      },
      "text/fhirpath": {
        source: "iana"
      },
      "text/flexfec": {
        source: "iana"
      },
      "text/fwdred": {
        source: "iana"
      },
      "text/gff3": {
        source: "iana"
      },
      "text/grammar-ref-list": {
        source: "iana"
      },
      "text/html": {
        source: "iana",
        compressible: true,
        extensions: ["html", "htm", "shtml"]
      },
      "text/jade": {
        extensions: ["jade"]
      },
      "text/javascript": {
        source: "iana",
        compressible: true
      },
      "text/jcr-cnd": {
        source: "iana"
      },
      "text/jsx": {
        compressible: true,
        extensions: ["jsx"]
      },
      "text/less": {
        compressible: true,
        extensions: ["less"]
      },
      "text/markdown": {
        source: "iana",
        compressible: true,
        extensions: ["markdown", "md"]
      },
      "text/mathml": {
        source: "nginx",
        extensions: ["mml"]
      },
      "text/mdx": {
        compressible: true,
        extensions: ["mdx"]
      },
      "text/mizar": {
        source: "iana"
      },
      "text/n3": {
        source: "iana",
        charset: "UTF-8",
        compressible: true,
        extensions: ["n3"]
      },
      "text/parameters": {
        source: "iana",
        charset: "UTF-8"
      },
      "text/parityfec": {
        source: "iana"
      },
      "text/plain": {
        source: "iana",
        compressible: true,
        extensions: ["txt", "text", "conf", "def", "list", "log", "in", "ini"]
      },
      "text/provenance-notation": {
        source: "iana",
        charset: "UTF-8"
      },
      "text/prs.fallenstein.rst": {
        source: "iana"
      },
      "text/prs.lines.tag": {
        source: "iana",
        extensions: ["dsc"]
      },
      "text/prs.prop.logic": {
        source: "iana"
      },
      "text/raptorfec": {
        source: "iana"
      },
      "text/red": {
        source: "iana"
      },
      "text/rfc822-headers": {
        source: "iana"
      },
      "text/richtext": {
        source: "iana",
        compressible: true,
        extensions: ["rtx"]
      },
      "text/rtf": {
        source: "iana",
        compressible: true,
        extensions: ["rtf"]
      },
      "text/rtp-enc-aescm128": {
        source: "iana"
      },
      "text/rtploopback": {
        source: "iana"
      },
      "text/rtx": {
        source: "iana"
      },
      "text/sgml": {
        source: "iana",
        extensions: ["sgml", "sgm"]
      },
      "text/shaclc": {
        source: "iana"
      },
      "text/shex": {
        source: "iana",
        extensions: ["shex"]
      },
      "text/slim": {
        extensions: ["slim", "slm"]
      },
      "text/spdx": {
        source: "iana",
        extensions: ["spdx"]
      },
      "text/strings": {
        source: "iana"
      },
      "text/stylus": {
        extensions: ["stylus", "styl"]
      },
      "text/t140": {
        source: "iana"
      },
      "text/tab-separated-values": {
        source: "iana",
        compressible: true,
        extensions: ["tsv"]
      },
      "text/troff": {
        source: "iana",
        extensions: ["t", "tr", "roff", "man", "me", "ms"]
      },
      "text/turtle": {
        source: "iana",
        charset: "UTF-8",
        extensions: ["ttl"]
      },
      "text/ulpfec": {
        source: "iana"
      },
      "text/uri-list": {
        source: "iana",
        compressible: true,
        extensions: ["uri", "uris", "urls"]
      },
      "text/vcard": {
        source: "iana",
        compressible: true,
        extensions: ["vcard"]
      },
      "text/vnd.a": {
        source: "iana"
      },
      "text/vnd.abc": {
        source: "iana"
      },
      "text/vnd.ascii-art": {
        source: "iana"
      },
      "text/vnd.curl": {
        source: "iana",
        extensions: ["curl"]
      },
      "text/vnd.curl.dcurl": {
        source: "apache",
        extensions: ["dcurl"]
      },
      "text/vnd.curl.mcurl": {
        source: "apache",
        extensions: ["mcurl"]
      },
      "text/vnd.curl.scurl": {
        source: "apache",
        extensions: ["scurl"]
      },
      "text/vnd.debian.copyright": {
        source: "iana",
        charset: "UTF-8"
      },
      "text/vnd.dmclientscript": {
        source: "iana"
      },
      "text/vnd.dvb.subtitle": {
        source: "iana",
        extensions: ["sub"]
      },
      "text/vnd.esmertec.theme-descriptor": {
        source: "iana",
        charset: "UTF-8"
      },
      "text/vnd.familysearch.gedcom": {
        source: "iana",
        extensions: ["ged"]
      },
      "text/vnd.ficlab.flt": {
        source: "iana"
      },
      "text/vnd.fly": {
        source: "iana",
        extensions: ["fly"]
      },
      "text/vnd.fmi.flexstor": {
        source: "iana",
        extensions: ["flx"]
      },
      "text/vnd.gml": {
        source: "iana"
      },
      "text/vnd.graphviz": {
        source: "iana",
        extensions: ["gv"]
      },
      "text/vnd.hans": {
        source: "iana"
      },
      "text/vnd.hgl": {
        source: "iana"
      },
      "text/vnd.in3d.3dml": {
        source: "iana",
        extensions: ["3dml"]
      },
      "text/vnd.in3d.spot": {
        source: "iana",
        extensions: ["spot"]
      },
      "text/vnd.iptc.newsml": {
        source: "iana"
      },
      "text/vnd.iptc.nitf": {
        source: "iana"
      },
      "text/vnd.latex-z": {
        source: "iana"
      },
      "text/vnd.motorola.reflex": {
        source: "iana"
      },
      "text/vnd.ms-mediapackage": {
        source: "iana"
      },
      "text/vnd.net2phone.commcenter.command": {
        source: "iana"
      },
      "text/vnd.radisys.msml-basic-layout": {
        source: "iana"
      },
      "text/vnd.senx.warpscript": {
        source: "iana"
      },
      "text/vnd.si.uricatalogue": {
        source: "iana"
      },
      "text/vnd.sosi": {
        source: "iana"
      },
      "text/vnd.sun.j2me.app-descriptor": {
        source: "iana",
        charset: "UTF-8",
        extensions: ["jad"]
      },
      "text/vnd.trolltech.linguist": {
        source: "iana",
        charset: "UTF-8"
      },
      "text/vnd.wap.si": {
        source: "iana"
      },
      "text/vnd.wap.sl": {
        source: "iana"
      },
      "text/vnd.wap.wml": {
        source: "iana",
        extensions: ["wml"]
      },
      "text/vnd.wap.wmlscript": {
        source: "iana",
        extensions: ["wmls"]
      },
      "text/vtt": {
        source: "iana",
        charset: "UTF-8",
        compressible: true,
        extensions: ["vtt"]
      },
      "text/x-asm": {
        source: "apache",
        extensions: ["s", "asm"]
      },
      "text/x-c": {
        source: "apache",
        extensions: ["c", "cc", "cxx", "cpp", "h", "hh", "dic"]
      },
      "text/x-component": {
        source: "nginx",
        extensions: ["htc"]
      },
      "text/x-fortran": {
        source: "apache",
        extensions: ["f", "for", "f77", "f90"]
      },
      "text/x-gwt-rpc": {
        compressible: true
      },
      "text/x-handlebars-template": {
        extensions: ["hbs"]
      },
      "text/x-java-source": {
        source: "apache",
        extensions: ["java"]
      },
      "text/x-jquery-tmpl": {
        compressible: true
      },
      "text/x-lua": {
        extensions: ["lua"]
      },
      "text/x-markdown": {
        compressible: true,
        extensions: ["mkd"]
      },
      "text/x-nfo": {
        source: "apache",
        extensions: ["nfo"]
      },
      "text/x-opml": {
        source: "apache",
        extensions: ["opml"]
      },
      "text/x-org": {
        compressible: true,
        extensions: ["org"]
      },
      "text/x-pascal": {
        source: "apache",
        extensions: ["p", "pas"]
      },
      "text/x-processing": {
        compressible: true,
        extensions: ["pde"]
      },
      "text/x-sass": {
        extensions: ["sass"]
      },
      "text/x-scss": {
        extensions: ["scss"]
      },
      "text/x-setext": {
        source: "apache",
        extensions: ["etx"]
      },
      "text/x-sfv": {
        source: "apache",
        extensions: ["sfv"]
      },
      "text/x-suse-ymp": {
        compressible: true,
        extensions: ["ymp"]
      },
      "text/x-uuencode": {
        source: "apache",
        extensions: ["uu"]
      },
      "text/x-vcalendar": {
        source: "apache",
        extensions: ["vcs"]
      },
      "text/x-vcard": {
        source: "apache",
        extensions: ["vcf"]
      },
      "text/xml": {
        source: "iana",
        compressible: true,
        extensions: ["xml"]
      },
      "text/xml-external-parsed-entity": {
        source: "iana"
      },
      "text/yaml": {
        compressible: true,
        extensions: ["yaml", "yml"]
      },
      "video/1d-interleaved-parityfec": {
        source: "iana"
      },
      "video/3gpp": {
        source: "iana",
        extensions: ["3gp", "3gpp"]
      },
      "video/3gpp-tt": {
        source: "iana"
      },
      "video/3gpp2": {
        source: "iana",
        extensions: ["3g2"]
      },
      "video/av1": {
        source: "iana"
      },
      "video/bmpeg": {
        source: "iana"
      },
      "video/bt656": {
        source: "iana"
      },
      "video/celb": {
        source: "iana"
      },
      "video/dv": {
        source: "iana"
      },
      "video/encaprtp": {
        source: "iana"
      },
      "video/ffv1": {
        source: "iana"
      },
      "video/flexfec": {
        source: "iana"
      },
      "video/h261": {
        source: "iana",
        extensions: ["h261"]
      },
      "video/h263": {
        source: "iana",
        extensions: ["h263"]
      },
      "video/h263-1998": {
        source: "iana"
      },
      "video/h263-2000": {
        source: "iana"
      },
      "video/h264": {
        source: "iana",
        extensions: ["h264"]
      },
      "video/h264-rcdo": {
        source: "iana"
      },
      "video/h264-svc": {
        source: "iana"
      },
      "video/h265": {
        source: "iana"
      },
      "video/iso.segment": {
        source: "iana",
        extensions: ["m4s"]
      },
      "video/jpeg": {
        source: "iana",
        extensions: ["jpgv"]
      },
      "video/jpeg2000": {
        source: "iana"
      },
      "video/jpm": {
        source: "apache",
        extensions: ["jpm", "jpgm"]
      },
      "video/jxsv": {
        source: "iana"
      },
      "video/mj2": {
        source: "iana",
        extensions: ["mj2", "mjp2"]
      },
      "video/mp1s": {
        source: "iana"
      },
      "video/mp2p": {
        source: "iana"
      },
      "video/mp2t": {
        source: "iana",
        extensions: ["ts"]
      },
      "video/mp4": {
        source: "iana",
        compressible: false,
        extensions: ["mp4", "mp4v", "mpg4"]
      },
      "video/mp4v-es": {
        source: "iana"
      },
      "video/mpeg": {
        source: "iana",
        compressible: false,
        extensions: ["mpeg", "mpg", "mpe", "m1v", "m2v"]
      },
      "video/mpeg4-generic": {
        source: "iana"
      },
      "video/mpv": {
        source: "iana"
      },
      "video/nv": {
        source: "iana"
      },
      "video/ogg": {
        source: "iana",
        compressible: false,
        extensions: ["ogv"]
      },
      "video/parityfec": {
        source: "iana"
      },
      "video/pointer": {
        source: "iana"
      },
      "video/quicktime": {
        source: "iana",
        compressible: false,
        extensions: ["qt", "mov"]
      },
      "video/raptorfec": {
        source: "iana"
      },
      "video/raw": {
        source: "iana"
      },
      "video/rtp-enc-aescm128": {
        source: "iana"
      },
      "video/rtploopback": {
        source: "iana"
      },
      "video/rtx": {
        source: "iana"
      },
      "video/scip": {
        source: "iana"
      },
      "video/smpte291": {
        source: "iana"
      },
      "video/smpte292m": {
        source: "iana"
      },
      "video/ulpfec": {
        source: "iana"
      },
      "video/vc1": {
        source: "iana"
      },
      "video/vc2": {
        source: "iana"
      },
      "video/vnd.cctv": {
        source: "iana"
      },
      "video/vnd.dece.hd": {
        source: "iana",
        extensions: ["uvh", "uvvh"]
      },
      "video/vnd.dece.mobile": {
        source: "iana",
        extensions: ["uvm", "uvvm"]
      },
      "video/vnd.dece.mp4": {
        source: "iana"
      },
      "video/vnd.dece.pd": {
        source: "iana",
        extensions: ["uvp", "uvvp"]
      },
      "video/vnd.dece.sd": {
        source: "iana",
        extensions: ["uvs", "uvvs"]
      },
      "video/vnd.dece.video": {
        source: "iana",
        extensions: ["uvv", "uvvv"]
      },
      "video/vnd.directv.mpeg": {
        source: "iana"
      },
      "video/vnd.directv.mpeg-tts": {
        source: "iana"
      },
      "video/vnd.dlna.mpeg-tts": {
        source: "iana"
      },
      "video/vnd.dvb.file": {
        source: "iana",
        extensions: ["dvb"]
      },
      "video/vnd.fvt": {
        source: "iana",
        extensions: ["fvt"]
      },
      "video/vnd.hns.video": {
        source: "iana"
      },
      "video/vnd.iptvforum.1dparityfec-1010": {
        source: "iana"
      },
      "video/vnd.iptvforum.1dparityfec-2005": {
        source: "iana"
      },
      "video/vnd.iptvforum.2dparityfec-1010": {
        source: "iana"
      },
      "video/vnd.iptvforum.2dparityfec-2005": {
        source: "iana"
      },
      "video/vnd.iptvforum.ttsavc": {
        source: "iana"
      },
      "video/vnd.iptvforum.ttsmpeg2": {
        source: "iana"
      },
      "video/vnd.motorola.video": {
        source: "iana"
      },
      "video/vnd.motorola.videop": {
        source: "iana"
      },
      "video/vnd.mpegurl": {
        source: "iana",
        extensions: ["mxu", "m4u"]
      },
      "video/vnd.ms-playready.media.pyv": {
        source: "iana",
        extensions: ["pyv"]
      },
      "video/vnd.nokia.interleaved-multimedia": {
        source: "iana"
      },
      "video/vnd.nokia.mp4vr": {
        source: "iana"
      },
      "video/vnd.nokia.videovoip": {
        source: "iana"
      },
      "video/vnd.objectvideo": {
        source: "iana"
      },
      "video/vnd.radgamettools.bink": {
        source: "iana"
      },
      "video/vnd.radgamettools.smacker": {
        source: "iana"
      },
      "video/vnd.sealed.mpeg1": {
        source: "iana"
      },
      "video/vnd.sealed.mpeg4": {
        source: "iana"
      },
      "video/vnd.sealed.swf": {
        source: "iana"
      },
      "video/vnd.sealedmedia.softseal.mov": {
        source: "iana"
      },
      "video/vnd.uvvu.mp4": {
        source: "iana",
        extensions: ["uvu", "uvvu"]
      },
      "video/vnd.vivo": {
        source: "iana",
        extensions: ["viv"]
      },
      "video/vnd.youtube.yt": {
        source: "iana"
      },
      "video/vp8": {
        source: "iana"
      },
      "video/vp9": {
        source: "iana"
      },
      "video/webm": {
        source: "apache",
        compressible: false,
        extensions: ["webm"]
      },
      "video/x-f4v": {
        source: "apache",
        extensions: ["f4v"]
      },
      "video/x-fli": {
        source: "apache",
        extensions: ["fli"]
      },
      "video/x-flv": {
        source: "apache",
        compressible: false,
        extensions: ["flv"]
      },
      "video/x-m4v": {
        source: "apache",
        extensions: ["m4v"]
      },
      "video/x-matroska": {
        source: "apache",
        compressible: false,
        extensions: ["mkv", "mk3d", "mks"]
      },
      "video/x-mng": {
        source: "apache",
        extensions: ["mng"]
      },
      "video/x-ms-asf": {
        source: "apache",
        extensions: ["asf", "asx"]
      },
      "video/x-ms-vob": {
        source: "apache",
        extensions: ["vob"]
      },
      "video/x-ms-wm": {
        source: "apache",
        extensions: ["wm"]
      },
      "video/x-ms-wmv": {
        source: "apache",
        compressible: false,
        extensions: ["wmv"]
      },
      "video/x-ms-wmx": {
        source: "apache",
        extensions: ["wmx"]
      },
      "video/x-ms-wvx": {
        source: "apache",
        extensions: ["wvx"]
      },
      "video/x-msvideo": {
        source: "apache",
        extensions: ["avi"]
      },
      "video/x-sgi-movie": {
        source: "apache",
        extensions: ["movie"]
      },
      "video/x-smv": {
        source: "apache",
        extensions: ["smv"]
      },
      "x-conference/x-cooltalk": {
        source: "apache",
        extensions: ["ice"]
      },
      "x-shader/x-fragment": {
        compressible: true
      },
      "x-shader/x-vertex": {
        compressible: true
      }
    };
  }
});

// node_modules/mime-db/index.js
var require_mime_db = __commonJS({
  "node_modules/mime-db/index.js"(exports2, module2) {
    module2.exports = require_db();
  }
});

// node_modules/mime-types/index.js
var require_mime_types = __commonJS({
  "node_modules/mime-types/index.js"(exports2) {
    "use strict";
    var db = require_mime_db();
    var extname = require("path").extname;
    var EXTRACT_TYPE_REGEXP = /^\s*([^;\s]*)(?:;|\s|$)/;
    var TEXT_TYPE_REGEXP = /^text\//i;
    exports2.charset = charset;
    exports2.charsets = { lookup: charset };
    exports2.contentType = contentType;
    exports2.extension = extension;
    exports2.extensions = /* @__PURE__ */ Object.create(null);
    exports2.lookup = lookup;
    exports2.types = /* @__PURE__ */ Object.create(null);
    populateMaps(exports2.extensions, exports2.types);
    function charset(type) {
      if (!type || typeof type !== "string") {
        return false;
      }
      var match = EXTRACT_TYPE_REGEXP.exec(type);
      var mime = match && db[match[1].toLowerCase()];
      if (mime && mime.charset) {
        return mime.charset;
      }
      if (match && TEXT_TYPE_REGEXP.test(match[1])) {
        return "UTF-8";
      }
      return false;
    }
    function contentType(str) {
      if (!str || typeof str !== "string") {
        return false;
      }
      var mime = str.indexOf("/") === -1 ? exports2.lookup(str) : str;
      if (!mime) {
        return false;
      }
      if (mime.indexOf("charset") === -1) {
        var charset2 = exports2.charset(mime);
        if (charset2) mime += "; charset=" + charset2.toLowerCase();
      }
      return mime;
    }
    function extension(type) {
      if (!type || typeof type !== "string") {
        return false;
      }
      var match = EXTRACT_TYPE_REGEXP.exec(type);
      var exts = match && exports2.extensions[match[1].toLowerCase()];
      if (!exts || !exts.length) {
        return false;
      }
      return exts[0];
    }
    function lookup(path) {
      if (!path || typeof path !== "string") {
        return false;
      }
      var extension2 = extname("x." + path).toLowerCase().substr(1);
      if (!extension2) {
        return false;
      }
      return exports2.types[extension2] || false;
    }
    function populateMaps(extensions, types) {
      var preference = ["nginx", "apache", void 0, "iana"];
      Object.keys(db).forEach(function forEachMimeType(type) {
        var mime = db[type];
        var exts = mime.extensions;
        if (!exts || !exts.length) {
          return;
        }
        extensions[type] = exts;
        for (var i = 0; i < exts.length; i++) {
          var extension2 = exts[i];
          if (types[extension2]) {
            var from = preference.indexOf(db[types[extension2]].source);
            var to = preference.indexOf(mime.source);
            if (types[extension2] !== "application/octet-stream" && (from > to || from === to && types[extension2].substr(0, 12) === "application/")) {
              continue;
            }
          }
          types[extension2] = type;
        }
      });
    }
  }
});

// node_modules/asynckit/lib/defer.js
var require_defer = __commonJS({
  "node_modules/asynckit/lib/defer.js"(exports2, module2) {
    module2.exports = defer;
    function defer(fn) {
      var nextTick = typeof setImmediate == "function" ? setImmediate : typeof process == "object" && typeof process.nextTick == "function" ? process.nextTick : null;
      if (nextTick) {
        nextTick(fn);
      } else {
        setTimeout(fn, 0);
      }
    }
  }
});

// node_modules/asynckit/lib/async.js
var require_async = __commonJS({
  "node_modules/asynckit/lib/async.js"(exports2, module2) {
    var defer = require_defer();
    module2.exports = async;
    function async(callback) {
      var isAsync = false;
      defer(function() {
        isAsync = true;
      });
      return function async_callback(err, result) {
        if (isAsync) {
          callback(err, result);
        } else {
          defer(function nextTick_callback() {
            callback(err, result);
          });
        }
      };
    }
  }
});

// node_modules/asynckit/lib/abort.js
var require_abort = __commonJS({
  "node_modules/asynckit/lib/abort.js"(exports2, module2) {
    module2.exports = abort;
    function abort(state) {
      Object.keys(state.jobs).forEach(clean.bind(state));
      state.jobs = {};
    }
    function clean(key) {
      if (typeof this.jobs[key] == "function") {
        this.jobs[key]();
      }
    }
  }
});

// node_modules/asynckit/lib/iterate.js
var require_iterate = __commonJS({
  "node_modules/asynckit/lib/iterate.js"(exports2, module2) {
    var async = require_async();
    var abort = require_abort();
    module2.exports = iterate;
    function iterate(list, iterator2, state, callback) {
      var key = state["keyedList"] ? state["keyedList"][state.index] : state.index;
      state.jobs[key] = runJob(iterator2, key, list[key], function(error, output) {
        if (!(key in state.jobs)) {
          return;
        }
        delete state.jobs[key];
        if (error) {
          abort(state);
        } else {
          state.results[key] = output;
        }
        callback(error, state.results);
      });
    }
    function runJob(iterator2, key, item, callback) {
      var aborter;
      if (iterator2.length == 2) {
        aborter = iterator2(item, async(callback));
      } else {
        aborter = iterator2(item, key, async(callback));
      }
      return aborter;
    }
  }
});

// node_modules/asynckit/lib/state.js
var require_state = __commonJS({
  "node_modules/asynckit/lib/state.js"(exports2, module2) {
    module2.exports = state;
    function state(list, sortMethod) {
      var isNamedList = !Array.isArray(list), initState = {
        index: 0,
        keyedList: isNamedList || sortMethod ? Object.keys(list) : null,
        jobs: {},
        results: isNamedList ? {} : [],
        size: isNamedList ? Object.keys(list).length : list.length
      };
      if (sortMethod) {
        initState.keyedList.sort(isNamedList ? sortMethod : function(a, b) {
          return sortMethod(list[a], list[b]);
        });
      }
      return initState;
    }
  }
});

// node_modules/asynckit/lib/terminator.js
var require_terminator = __commonJS({
  "node_modules/asynckit/lib/terminator.js"(exports2, module2) {
    var abort = require_abort();
    var async = require_async();
    module2.exports = terminator;
    function terminator(callback) {
      if (!Object.keys(this.jobs).length) {
        return;
      }
      this.index = this.size;
      abort(this);
      async(callback)(null, this.results);
    }
  }
});

// node_modules/asynckit/parallel.js
var require_parallel = __commonJS({
  "node_modules/asynckit/parallel.js"(exports2, module2) {
    var iterate = require_iterate();
    var initState = require_state();
    var terminator = require_terminator();
    module2.exports = parallel;
    function parallel(list, iterator2, callback) {
      var state = initState(list);
      while (state.index < (state["keyedList"] || list).length) {
        iterate(list, iterator2, state, function(error, result) {
          if (error) {
            callback(error, result);
            return;
          }
          if (Object.keys(state.jobs).length === 0) {
            callback(null, state.results);
            return;
          }
        });
        state.index++;
      }
      return terminator.bind(state, callback);
    }
  }
});

// node_modules/asynckit/serialOrdered.js
var require_serialOrdered = __commonJS({
  "node_modules/asynckit/serialOrdered.js"(exports2, module2) {
    var iterate = require_iterate();
    var initState = require_state();
    var terminator = require_terminator();
    module2.exports = serialOrdered;
    module2.exports.ascending = ascending;
    module2.exports.descending = descending;
    function serialOrdered(list, iterator2, sortMethod, callback) {
      var state = initState(list, sortMethod);
      iterate(list, iterator2, state, function iteratorHandler(error, result) {
        if (error) {
          callback(error, result);
          return;
        }
        state.index++;
        if (state.index < (state["keyedList"] || list).length) {
          iterate(list, iterator2, state, iteratorHandler);
          return;
        }
        callback(null, state.results);
      });
      return terminator.bind(state, callback);
    }
    function ascending(a, b) {
      return a < b ? -1 : a > b ? 1 : 0;
    }
    function descending(a, b) {
      return -1 * ascending(a, b);
    }
  }
});

// node_modules/asynckit/serial.js
var require_serial = __commonJS({
  "node_modules/asynckit/serial.js"(exports2, module2) {
    var serialOrdered = require_serialOrdered();
    module2.exports = serial;
    function serial(list, iterator2, callback) {
      return serialOrdered(list, iterator2, null, callback);
    }
  }
});

// node_modules/asynckit/index.js
var require_asynckit = __commonJS({
  "node_modules/asynckit/index.js"(exports2, module2) {
    module2.exports = {
      parallel: require_parallel(),
      serial: require_serial(),
      serialOrdered: require_serialOrdered()
    };
  }
});

// node_modules/es-object-atoms/index.js
var require_es_object_atoms = __commonJS({
  "node_modules/es-object-atoms/index.js"(exports2, module2) {
    "use strict";
    module2.exports = Object;
  }
});

// node_modules/es-errors/index.js
var require_es_errors = __commonJS({
  "node_modules/es-errors/index.js"(exports2, module2) {
    "use strict";
    module2.exports = Error;
  }
});

// node_modules/es-errors/eval.js
var require_eval = __commonJS({
  "node_modules/es-errors/eval.js"(exports2, module2) {
    "use strict";
    module2.exports = EvalError;
  }
});

// node_modules/es-errors/range.js
var require_range = __commonJS({
  "node_modules/es-errors/range.js"(exports2, module2) {
    "use strict";
    module2.exports = RangeError;
  }
});

// node_modules/es-errors/ref.js
var require_ref = __commonJS({
  "node_modules/es-errors/ref.js"(exports2, module2) {
    "use strict";
    module2.exports = ReferenceError;
  }
});

// node_modules/es-errors/syntax.js
var require_syntax = __commonJS({
  "node_modules/es-errors/syntax.js"(exports2, module2) {
    "use strict";
    module2.exports = SyntaxError;
  }
});

// node_modules/es-errors/type.js
var require_type = __commonJS({
  "node_modules/es-errors/type.js"(exports2, module2) {
    "use strict";
    module2.exports = TypeError;
  }
});

// node_modules/es-errors/uri.js
var require_uri = __commonJS({
  "node_modules/es-errors/uri.js"(exports2, module2) {
    "use strict";
    module2.exports = URIError;
  }
});

// node_modules/math-intrinsics/abs.js
var require_abs = __commonJS({
  "node_modules/math-intrinsics/abs.js"(exports2, module2) {
    "use strict";
    module2.exports = Math.abs;
  }
});

// node_modules/math-intrinsics/floor.js
var require_floor = __commonJS({
  "node_modules/math-intrinsics/floor.js"(exports2, module2) {
    "use strict";
    module2.exports = Math.floor;
  }
});

// node_modules/math-intrinsics/max.js
var require_max = __commonJS({
  "node_modules/math-intrinsics/max.js"(exports2, module2) {
    "use strict";
    module2.exports = Math.max;
  }
});

// node_modules/math-intrinsics/min.js
var require_min = __commonJS({
  "node_modules/math-intrinsics/min.js"(exports2, module2) {
    "use strict";
    module2.exports = Math.min;
  }
});

// node_modules/math-intrinsics/pow.js
var require_pow = __commonJS({
  "node_modules/math-intrinsics/pow.js"(exports2, module2) {
    "use strict";
    module2.exports = Math.pow;
  }
});

// node_modules/math-intrinsics/round.js
var require_round = __commonJS({
  "node_modules/math-intrinsics/round.js"(exports2, module2) {
    "use strict";
    module2.exports = Math.round;
  }
});

// node_modules/math-intrinsics/isNaN.js
var require_isNaN = __commonJS({
  "node_modules/math-intrinsics/isNaN.js"(exports2, module2) {
    "use strict";
    module2.exports = Number.isNaN || function isNaN2(a) {
      return a !== a;
    };
  }
});

// node_modules/math-intrinsics/sign.js
var require_sign = __commonJS({
  "node_modules/math-intrinsics/sign.js"(exports2, module2) {
    "use strict";
    var $isNaN = require_isNaN();
    module2.exports = function sign(number) {
      if ($isNaN(number) || number === 0) {
        return number;
      }
      return number < 0 ? -1 : 1;
    };
  }
});

// node_modules/gopd/gOPD.js
var require_gOPD = __commonJS({
  "node_modules/gopd/gOPD.js"(exports2, module2) {
    "use strict";
    module2.exports = Object.getOwnPropertyDescriptor;
  }
});

// node_modules/gopd/index.js
var require_gopd = __commonJS({
  "node_modules/gopd/index.js"(exports2, module2) {
    "use strict";
    var $gOPD = require_gOPD();
    if ($gOPD) {
      try {
        $gOPD([], "length");
      } catch (e) {
        $gOPD = null;
      }
    }
    module2.exports = $gOPD;
  }
});

// node_modules/es-define-property/index.js
var require_es_define_property = __commonJS({
  "node_modules/es-define-property/index.js"(exports2, module2) {
    "use strict";
    var $defineProperty = Object.defineProperty || false;
    if ($defineProperty) {
      try {
        $defineProperty({}, "a", { value: 1 });
      } catch (e) {
        $defineProperty = false;
      }
    }
    module2.exports = $defineProperty;
  }
});

// node_modules/has-symbols/shams.js
var require_shams = __commonJS({
  "node_modules/has-symbols/shams.js"(exports2, module2) {
    "use strict";
    module2.exports = function hasSymbols() {
      if (typeof Symbol !== "function" || typeof Object.getOwnPropertySymbols !== "function") {
        return false;
      }
      if (typeof Symbol.iterator === "symbol") {
        return true;
      }
      var obj = {};
      var sym = Symbol("test");
      var symObj = Object(sym);
      if (typeof sym === "string") {
        return false;
      }
      if (Object.prototype.toString.call(sym) !== "[object Symbol]") {
        return false;
      }
      if (Object.prototype.toString.call(symObj) !== "[object Symbol]") {
        return false;
      }
      var symVal = 42;
      obj[sym] = symVal;
      for (var _ in obj) {
        return false;
      }
      if (typeof Object.keys === "function" && Object.keys(obj).length !== 0) {
        return false;
      }
      if (typeof Object.getOwnPropertyNames === "function" && Object.getOwnPropertyNames(obj).length !== 0) {
        return false;
      }
      var syms = Object.getOwnPropertySymbols(obj);
      if (syms.length !== 1 || syms[0] !== sym) {
        return false;
      }
      if (!Object.prototype.propertyIsEnumerable.call(obj, sym)) {
        return false;
      }
      if (typeof Object.getOwnPropertyDescriptor === "function") {
        var descriptor = (
          /** @type {PropertyDescriptor} */
          Object.getOwnPropertyDescriptor(obj, sym)
        );
        if (descriptor.value !== symVal || descriptor.enumerable !== true) {
          return false;
        }
      }
      return true;
    };
  }
});

// node_modules/has-symbols/index.js
var require_has_symbols = __commonJS({
  "node_modules/has-symbols/index.js"(exports2, module2) {
    "use strict";
    var origSymbol = typeof Symbol !== "undefined" && Symbol;
    var hasSymbolSham = require_shams();
    module2.exports = function hasNativeSymbols() {
      if (typeof origSymbol !== "function") {
        return false;
      }
      if (typeof Symbol !== "function") {
        return false;
      }
      if (typeof origSymbol("foo") !== "symbol") {
        return false;
      }
      if (typeof Symbol("bar") !== "symbol") {
        return false;
      }
      return hasSymbolSham();
    };
  }
});

// node_modules/get-proto/Reflect.getPrototypeOf.js
var require_Reflect_getPrototypeOf = __commonJS({
  "node_modules/get-proto/Reflect.getPrototypeOf.js"(exports2, module2) {
    "use strict";
    module2.exports = typeof Reflect !== "undefined" && Reflect.getPrototypeOf || null;
  }
});

// node_modules/get-proto/Object.getPrototypeOf.js
var require_Object_getPrototypeOf = __commonJS({
  "node_modules/get-proto/Object.getPrototypeOf.js"(exports2, module2) {
    "use strict";
    var $Object = require_es_object_atoms();
    module2.exports = $Object.getPrototypeOf || null;
  }
});

// node_modules/function-bind/implementation.js
var require_implementation = __commonJS({
  "node_modules/function-bind/implementation.js"(exports2, module2) {
    "use strict";
    var ERROR_MESSAGE = "Function.prototype.bind called on incompatible ";
    var toStr = Object.prototype.toString;
    var max = Math.max;
    var funcType = "[object Function]";
    var concatty = function concatty2(a, b) {
      var arr = [];
      for (var i = 0; i < a.length; i += 1) {
        arr[i] = a[i];
      }
      for (var j = 0; j < b.length; j += 1) {
        arr[j + a.length] = b[j];
      }
      return arr;
    };
    var slicy = function slicy2(arrLike, offset) {
      var arr = [];
      for (var i = offset || 0, j = 0; i < arrLike.length; i += 1, j += 1) {
        arr[j] = arrLike[i];
      }
      return arr;
    };
    var joiny = function(arr, joiner) {
      var str = "";
      for (var i = 0; i < arr.length; i += 1) {
        str += arr[i];
        if (i + 1 < arr.length) {
          str += joiner;
        }
      }
      return str;
    };
    module2.exports = function bind2(that) {
      var target = this;
      if (typeof target !== "function" || toStr.apply(target) !== funcType) {
        throw new TypeError(ERROR_MESSAGE + target);
      }
      var args = slicy(arguments, 1);
      var bound;
      var binder = function() {
        if (this instanceof bound) {
          var result = target.apply(
            this,
            concatty(args, arguments)
          );
          if (Object(result) === result) {
            return result;
          }
          return this;
        }
        return target.apply(
          that,
          concatty(args, arguments)
        );
      };
      var boundLength = max(0, target.length - args.length);
      var boundArgs = [];
      for (var i = 0; i < boundLength; i++) {
        boundArgs[i] = "$" + i;
      }
      bound = Function("binder", "return function (" + joiny(boundArgs, ",") + "){ return binder.apply(this,arguments); }")(binder);
      if (target.prototype) {
        var Empty = function Empty2() {
        };
        Empty.prototype = target.prototype;
        bound.prototype = new Empty();
        Empty.prototype = null;
      }
      return bound;
    };
  }
});

// node_modules/function-bind/index.js
var require_function_bind = __commonJS({
  "node_modules/function-bind/index.js"(exports2, module2) {
    "use strict";
    var implementation = require_implementation();
    module2.exports = Function.prototype.bind || implementation;
  }
});

// node_modules/call-bind-apply-helpers/functionCall.js
var require_functionCall = __commonJS({
  "node_modules/call-bind-apply-helpers/functionCall.js"(exports2, module2) {
    "use strict";
    module2.exports = Function.prototype.call;
  }
});

// node_modules/call-bind-apply-helpers/functionApply.js
var require_functionApply = __commonJS({
  "node_modules/call-bind-apply-helpers/functionApply.js"(exports2, module2) {
    "use strict";
    module2.exports = Function.prototype.apply;
  }
});

// node_modules/call-bind-apply-helpers/reflectApply.js
var require_reflectApply = __commonJS({
  "node_modules/call-bind-apply-helpers/reflectApply.js"(exports2, module2) {
    "use strict";
    module2.exports = typeof Reflect !== "undefined" && Reflect && Reflect.apply;
  }
});

// node_modules/call-bind-apply-helpers/actualApply.js
var require_actualApply = __commonJS({
  "node_modules/call-bind-apply-helpers/actualApply.js"(exports2, module2) {
    "use strict";
    var bind2 = require_function_bind();
    var $apply = require_functionApply();
    var $call = require_functionCall();
    var $reflectApply = require_reflectApply();
    module2.exports = $reflectApply || bind2.call($call, $apply);
  }
});

// node_modules/call-bind-apply-helpers/index.js
var require_call_bind_apply_helpers = __commonJS({
  "node_modules/call-bind-apply-helpers/index.js"(exports2, module2) {
    "use strict";
    var bind2 = require_function_bind();
    var $TypeError = require_type();
    var $call = require_functionCall();
    var $actualApply = require_actualApply();
    module2.exports = function callBindBasic(args) {
      if (args.length < 1 || typeof args[0] !== "function") {
        throw new $TypeError("a function is required");
      }
      return $actualApply(bind2, $call, args);
    };
  }
});

// node_modules/dunder-proto/get.js
var require_get = __commonJS({
  "node_modules/dunder-proto/get.js"(exports2, module2) {
    "use strict";
    var callBind = require_call_bind_apply_helpers();
    var gOPD = require_gopd();
    var hasProtoAccessor;
    try {
      hasProtoAccessor = /** @type {{ __proto__?: typeof Array.prototype }} */
      [].__proto__ === Array.prototype;
    } catch (e) {
      if (!e || typeof e !== "object" || !("code" in e) || e.code !== "ERR_PROTO_ACCESS") {
        throw e;
      }
    }
    var desc = !!hasProtoAccessor && gOPD && gOPD(
      Object.prototype,
      /** @type {keyof typeof Object.prototype} */
      "__proto__"
    );
    var $Object = Object;
    var $getPrototypeOf = $Object.getPrototypeOf;
    module2.exports = desc && typeof desc.get === "function" ? callBind([desc.get]) : typeof $getPrototypeOf === "function" ? (
      /** @type {import('./get')} */
      function getDunder(value) {
        return $getPrototypeOf(value == null ? value : $Object(value));
      }
    ) : false;
  }
});

// node_modules/get-proto/index.js
var require_get_proto = __commonJS({
  "node_modules/get-proto/index.js"(exports2, module2) {
    "use strict";
    var reflectGetProto = require_Reflect_getPrototypeOf();
    var originalGetProto = require_Object_getPrototypeOf();
    var getDunderProto = require_get();
    module2.exports = reflectGetProto ? function getProto(O) {
      return reflectGetProto(O);
    } : originalGetProto ? function getProto(O) {
      if (!O || typeof O !== "object" && typeof O !== "function") {
        throw new TypeError("getProto: not an object");
      }
      return originalGetProto(O);
    } : getDunderProto ? function getProto(O) {
      return getDunderProto(O);
    } : null;
  }
});

// node_modules/hasown/index.js
var require_hasown = __commonJS({
  "node_modules/hasown/index.js"(exports2, module2) {
    "use strict";
    var call = Function.prototype.call;
    var $hasOwn = Object.prototype.hasOwnProperty;
    var bind2 = require_function_bind();
    module2.exports = bind2.call(call, $hasOwn);
  }
});

// node_modules/get-intrinsic/index.js
var require_get_intrinsic = __commonJS({
  "node_modules/get-intrinsic/index.js"(exports2, module2) {
    "use strict";
    var undefined2;
    var $Object = require_es_object_atoms();
    var $Error = require_es_errors();
    var $EvalError = require_eval();
    var $RangeError = require_range();
    var $ReferenceError = require_ref();
    var $SyntaxError = require_syntax();
    var $TypeError = require_type();
    var $URIError = require_uri();
    var abs = require_abs();
    var floor = require_floor();
    var max = require_max();
    var min = require_min();
    var pow = require_pow();
    var round = require_round();
    var sign = require_sign();
    var $Function = Function;
    var getEvalledConstructor = function(expressionSyntax) {
      try {
        return $Function('"use strict"; return (' + expressionSyntax + ").constructor;")();
      } catch (e) {
      }
    };
    var $gOPD = require_gopd();
    var $defineProperty = require_es_define_property();
    var throwTypeError = function() {
      throw new $TypeError();
    };
    var ThrowTypeError = $gOPD ? function() {
      try {
        arguments.callee;
        return throwTypeError;
      } catch (calleeThrows) {
        try {
          return $gOPD(arguments, "callee").get;
        } catch (gOPDthrows) {
          return throwTypeError;
        }
      }
    }() : throwTypeError;
    var hasSymbols = require_has_symbols()();
    var getProto = require_get_proto();
    var $ObjectGPO = require_Object_getPrototypeOf();
    var $ReflectGPO = require_Reflect_getPrototypeOf();
    var $apply = require_functionApply();
    var $call = require_functionCall();
    var needsEval = {};
    var TypedArray = typeof Uint8Array === "undefined" || !getProto ? undefined2 : getProto(Uint8Array);
    var INTRINSICS = {
      __proto__: null,
      "%AggregateError%": typeof AggregateError === "undefined" ? undefined2 : AggregateError,
      "%Array%": Array,
      "%ArrayBuffer%": typeof ArrayBuffer === "undefined" ? undefined2 : ArrayBuffer,
      "%ArrayIteratorPrototype%": hasSymbols && getProto ? getProto([][Symbol.iterator]()) : undefined2,
      "%AsyncFromSyncIteratorPrototype%": undefined2,
      "%AsyncFunction%": needsEval,
      "%AsyncGenerator%": needsEval,
      "%AsyncGeneratorFunction%": needsEval,
      "%AsyncIteratorPrototype%": needsEval,
      "%Atomics%": typeof Atomics === "undefined" ? undefined2 : Atomics,
      "%BigInt%": typeof BigInt === "undefined" ? undefined2 : BigInt,
      "%BigInt64Array%": typeof BigInt64Array === "undefined" ? undefined2 : BigInt64Array,
      "%BigUint64Array%": typeof BigUint64Array === "undefined" ? undefined2 : BigUint64Array,
      "%Boolean%": Boolean,
      "%DataView%": typeof DataView === "undefined" ? undefined2 : DataView,
      "%Date%": Date,
      "%decodeURI%": decodeURI,
      "%decodeURIComponent%": decodeURIComponent,
      "%encodeURI%": encodeURI,
      "%encodeURIComponent%": encodeURIComponent,
      "%Error%": $Error,
      "%eval%": eval,
      // eslint-disable-line no-eval
      "%EvalError%": $EvalError,
      "%Float16Array%": typeof Float16Array === "undefined" ? undefined2 : Float16Array,
      "%Float32Array%": typeof Float32Array === "undefined" ? undefined2 : Float32Array,
      "%Float64Array%": typeof Float64Array === "undefined" ? undefined2 : Float64Array,
      "%FinalizationRegistry%": typeof FinalizationRegistry === "undefined" ? undefined2 : FinalizationRegistry,
      "%Function%": $Function,
      "%GeneratorFunction%": needsEval,
      "%Int8Array%": typeof Int8Array === "undefined" ? undefined2 : Int8Array,
      "%Int16Array%": typeof Int16Array === "undefined" ? undefined2 : Int16Array,
      "%Int32Array%": typeof Int32Array === "undefined" ? undefined2 : Int32Array,
      "%isFinite%": isFinite,
      "%isNaN%": isNaN,
      "%IteratorPrototype%": hasSymbols && getProto ? getProto(getProto([][Symbol.iterator]())) : undefined2,
      "%JSON%": typeof JSON === "object" ? JSON : undefined2,
      "%Map%": typeof Map === "undefined" ? undefined2 : Map,
      "%MapIteratorPrototype%": typeof Map === "undefined" || !hasSymbols || !getProto ? undefined2 : getProto((/* @__PURE__ */ new Map())[Symbol.iterator]()),
      "%Math%": Math,
      "%Number%": Number,
      "%Object%": $Object,
      "%Object.getOwnPropertyDescriptor%": $gOPD,
      "%parseFloat%": parseFloat,
      "%parseInt%": parseInt,
      "%Promise%": typeof Promise === "undefined" ? undefined2 : Promise,
      "%Proxy%": typeof Proxy === "undefined" ? undefined2 : Proxy,
      "%RangeError%": $RangeError,
      "%ReferenceError%": $ReferenceError,
      "%Reflect%": typeof Reflect === "undefined" ? undefined2 : Reflect,
      "%RegExp%": RegExp,
      "%Set%": typeof Set === "undefined" ? undefined2 : Set,
      "%SetIteratorPrototype%": typeof Set === "undefined" || !hasSymbols || !getProto ? undefined2 : getProto((/* @__PURE__ */ new Set())[Symbol.iterator]()),
      "%SharedArrayBuffer%": typeof SharedArrayBuffer === "undefined" ? undefined2 : SharedArrayBuffer,
      "%String%": String,
      "%StringIteratorPrototype%": hasSymbols && getProto ? getProto(""[Symbol.iterator]()) : undefined2,
      "%Symbol%": hasSymbols ? Symbol : undefined2,
      "%SyntaxError%": $SyntaxError,
      "%ThrowTypeError%": ThrowTypeError,
      "%TypedArray%": TypedArray,
      "%TypeError%": $TypeError,
      "%Uint8Array%": typeof Uint8Array === "undefined" ? undefined2 : Uint8Array,
      "%Uint8ClampedArray%": typeof Uint8ClampedArray === "undefined" ? undefined2 : Uint8ClampedArray,
      "%Uint16Array%": typeof Uint16Array === "undefined" ? undefined2 : Uint16Array,
      "%Uint32Array%": typeof Uint32Array === "undefined" ? undefined2 : Uint32Array,
      "%URIError%": $URIError,
      "%WeakMap%": typeof WeakMap === "undefined" ? undefined2 : WeakMap,
      "%WeakRef%": typeof WeakRef === "undefined" ? undefined2 : WeakRef,
      "%WeakSet%": typeof WeakSet === "undefined" ? undefined2 : WeakSet,
      "%Function.prototype.call%": $call,
      "%Function.prototype.apply%": $apply,
      "%Object.defineProperty%": $defineProperty,
      "%Object.getPrototypeOf%": $ObjectGPO,
      "%Math.abs%": abs,
      "%Math.floor%": floor,
      "%Math.max%": max,
      "%Math.min%": min,
      "%Math.pow%": pow,
      "%Math.round%": round,
      "%Math.sign%": sign,
      "%Reflect.getPrototypeOf%": $ReflectGPO
    };
    if (getProto) {
      try {
        null.error;
      } catch (e) {
        errorProto = getProto(getProto(e));
        INTRINSICS["%Error.prototype%"] = errorProto;
      }
    }
    var errorProto;
    var doEval = function doEval2(name) {
      var value;
      if (name === "%AsyncFunction%") {
        value = getEvalledConstructor("async function () {}");
      } else if (name === "%GeneratorFunction%") {
        value = getEvalledConstructor("function* () {}");
      } else if (name === "%AsyncGeneratorFunction%") {
        value = getEvalledConstructor("async function* () {}");
      } else if (name === "%AsyncGenerator%") {
        var fn = doEval2("%AsyncGeneratorFunction%");
        if (fn) {
          value = fn.prototype;
        }
      } else if (name === "%AsyncIteratorPrototype%") {
        var gen = doEval2("%AsyncGenerator%");
        if (gen && getProto) {
          value = getProto(gen.prototype);
        }
      }
      INTRINSICS[name] = value;
      return value;
    };
    var LEGACY_ALIASES = {
      __proto__: null,
      "%ArrayBufferPrototype%": ["ArrayBuffer", "prototype"],
      "%ArrayPrototype%": ["Array", "prototype"],
      "%ArrayProto_entries%": ["Array", "prototype", "entries"],
      "%ArrayProto_forEach%": ["Array", "prototype", "forEach"],
      "%ArrayProto_keys%": ["Array", "prototype", "keys"],
      "%ArrayProto_values%": ["Array", "prototype", "values"],
      "%AsyncFunctionPrototype%": ["AsyncFunction", "prototype"],
      "%AsyncGenerator%": ["AsyncGeneratorFunction", "prototype"],
      "%AsyncGeneratorPrototype%": ["AsyncGeneratorFunction", "prototype", "prototype"],
      "%BooleanPrototype%": ["Boolean", "prototype"],
      "%DataViewPrototype%": ["DataView", "prototype"],
      "%DatePrototype%": ["Date", "prototype"],
      "%ErrorPrototype%": ["Error", "prototype"],
      "%EvalErrorPrototype%": ["EvalError", "prototype"],
      "%Float32ArrayPrototype%": ["Float32Array", "prototype"],
      "%Float64ArrayPrototype%": ["Float64Array", "prototype"],
      "%FunctionPrototype%": ["Function", "prototype"],
      "%Generator%": ["GeneratorFunction", "prototype"],
      "%GeneratorPrototype%": ["GeneratorFunction", "prototype", "prototype"],
      "%Int8ArrayPrototype%": ["Int8Array", "prototype"],
      "%Int16ArrayPrototype%": ["Int16Array", "prototype"],
      "%Int32ArrayPrototype%": ["Int32Array", "prototype"],
      "%JSONParse%": ["JSON", "parse"],
      "%JSONStringify%": ["JSON", "stringify"],
      "%MapPrototype%": ["Map", "prototype"],
      "%NumberPrototype%": ["Number", "prototype"],
      "%ObjectPrototype%": ["Object", "prototype"],
      "%ObjProto_toString%": ["Object", "prototype", "toString"],
      "%ObjProto_valueOf%": ["Object", "prototype", "valueOf"],
      "%PromisePrototype%": ["Promise", "prototype"],
      "%PromiseProto_then%": ["Promise", "prototype", "then"],
      "%Promise_all%": ["Promise", "all"],
      "%Promise_reject%": ["Promise", "reject"],
      "%Promise_resolve%": ["Promise", "resolve"],
      "%RangeErrorPrototype%": ["RangeError", "prototype"],
      "%ReferenceErrorPrototype%": ["ReferenceError", "prototype"],
      "%RegExpPrototype%": ["RegExp", "prototype"],
      "%SetPrototype%": ["Set", "prototype"],
      "%SharedArrayBufferPrototype%": ["SharedArrayBuffer", "prototype"],
      "%StringPrototype%": ["String", "prototype"],
      "%SymbolPrototype%": ["Symbol", "prototype"],
      "%SyntaxErrorPrototype%": ["SyntaxError", "prototype"],
      "%TypedArrayPrototype%": ["TypedArray", "prototype"],
      "%TypeErrorPrototype%": ["TypeError", "prototype"],
      "%Uint8ArrayPrototype%": ["Uint8Array", "prototype"],
      "%Uint8ClampedArrayPrototype%": ["Uint8ClampedArray", "prototype"],
      "%Uint16ArrayPrototype%": ["Uint16Array", "prototype"],
      "%Uint32ArrayPrototype%": ["Uint32Array", "prototype"],
      "%URIErrorPrototype%": ["URIError", "prototype"],
      "%WeakMapPrototype%": ["WeakMap", "prototype"],
      "%WeakSetPrototype%": ["WeakSet", "prototype"]
    };
    var bind2 = require_function_bind();
    var hasOwn = require_hasown();
    var $concat = bind2.call($call, Array.prototype.concat);
    var $spliceApply = bind2.call($apply, Array.prototype.splice);
    var $replace = bind2.call($call, String.prototype.replace);
    var $strSlice = bind2.call($call, String.prototype.slice);
    var $exec = bind2.call($call, RegExp.prototype.exec);
    var rePropName = /[^%.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|%$))/g;
    var reEscapeChar = /\\(\\)?/g;
    var stringToPath = function stringToPath2(string) {
      var first = $strSlice(string, 0, 1);
      var last = $strSlice(string, -1);
      if (first === "%" && last !== "%") {
        throw new $SyntaxError("invalid intrinsic syntax, expected closing `%`");
      } else if (last === "%" && first !== "%") {
        throw new $SyntaxError("invalid intrinsic syntax, expected opening `%`");
      }
      var result = [];
      $replace(string, rePropName, function(match, number, quote, subString) {
        result[result.length] = quote ? $replace(subString, reEscapeChar, "$1") : number || match;
      });
      return result;
    };
    var getBaseIntrinsic = function getBaseIntrinsic2(name, allowMissing) {
      var intrinsicName = name;
      var alias;
      if (hasOwn(LEGACY_ALIASES, intrinsicName)) {
        alias = LEGACY_ALIASES[intrinsicName];
        intrinsicName = "%" + alias[0] + "%";
      }
      if (hasOwn(INTRINSICS, intrinsicName)) {
        var value = INTRINSICS[intrinsicName];
        if (value === needsEval) {
          value = doEval(intrinsicName);
        }
        if (typeof value === "undefined" && !allowMissing) {
          throw new $TypeError("intrinsic " + name + " exists, but is not available. Please file an issue!");
        }
        return {
          alias,
          name: intrinsicName,
          value
        };
      }
      throw new $SyntaxError("intrinsic " + name + " does not exist!");
    };
    module2.exports = function GetIntrinsic(name, allowMissing) {
      if (typeof name !== "string" || name.length === 0) {
        throw new $TypeError("intrinsic name must be a non-empty string");
      }
      if (arguments.length > 1 && typeof allowMissing !== "boolean") {
        throw new $TypeError('"allowMissing" argument must be a boolean');
      }
      if ($exec(/^%?[^%]*%?$/, name) === null) {
        throw new $SyntaxError("`%` may not be present anywhere but at the beginning and end of the intrinsic name");
      }
      var parts = stringToPath(name);
      var intrinsicBaseName = parts.length > 0 ? parts[0] : "";
      var intrinsic = getBaseIntrinsic("%" + intrinsicBaseName + "%", allowMissing);
      var intrinsicRealName = intrinsic.name;
      var value = intrinsic.value;
      var skipFurtherCaching = false;
      var alias = intrinsic.alias;
      if (alias) {
        intrinsicBaseName = alias[0];
        $spliceApply(parts, $concat([0, 1], alias));
      }
      for (var i = 1, isOwn = true; i < parts.length; i += 1) {
        var part = parts[i];
        var first = $strSlice(part, 0, 1);
        var last = $strSlice(part, -1);
        if ((first === '"' || first === "'" || first === "`" || (last === '"' || last === "'" || last === "`")) && first !== last) {
          throw new $SyntaxError("property names with quotes must have matching quotes");
        }
        if (part === "constructor" || !isOwn) {
          skipFurtherCaching = true;
        }
        intrinsicBaseName += "." + part;
        intrinsicRealName = "%" + intrinsicBaseName + "%";
        if (hasOwn(INTRINSICS, intrinsicRealName)) {
          value = INTRINSICS[intrinsicRealName];
        } else if (value != null) {
          if (!(part in value)) {
            if (!allowMissing) {
              throw new $TypeError("base intrinsic for " + name + " exists, but the property is not available.");
            }
            return void 0;
          }
          if ($gOPD && i + 1 >= parts.length) {
            var desc = $gOPD(value, part);
            isOwn = !!desc;
            if (isOwn && "get" in desc && !("originalValue" in desc.get)) {
              value = desc.get;
            } else {
              value = value[part];
            }
          } else {
            isOwn = hasOwn(value, part);
            value = value[part];
          }
          if (isOwn && !skipFurtherCaching) {
            INTRINSICS[intrinsicRealName] = value;
          }
        }
      }
      return value;
    };
  }
});

// node_modules/has-tostringtag/shams.js
var require_shams2 = __commonJS({
  "node_modules/has-tostringtag/shams.js"(exports2, module2) {
    "use strict";
    var hasSymbols = require_shams();
    module2.exports = function hasToStringTagShams() {
      return hasSymbols() && !!Symbol.toStringTag;
    };
  }
});

// node_modules/es-set-tostringtag/index.js
var require_es_set_tostringtag = __commonJS({
  "node_modules/es-set-tostringtag/index.js"(exports2, module2) {
    "use strict";
    var GetIntrinsic = require_get_intrinsic();
    var $defineProperty = GetIntrinsic("%Object.defineProperty%", true);
    var hasToStringTag = require_shams2()();
    var hasOwn = require_hasown();
    var $TypeError = require_type();
    var toStringTag2 = hasToStringTag ? Symbol.toStringTag : null;
    module2.exports = function setToStringTag(object, value) {
      var overrideIfSet = arguments.length > 2 && !!arguments[2] && arguments[2].force;
      var nonConfigurable = arguments.length > 2 && !!arguments[2] && arguments[2].nonConfigurable;
      if (typeof overrideIfSet !== "undefined" && typeof overrideIfSet !== "boolean" || typeof nonConfigurable !== "undefined" && typeof nonConfigurable !== "boolean") {
        throw new $TypeError("if provided, the `overrideIfSet` and `nonConfigurable` options must be booleans");
      }
      if (toStringTag2 && (overrideIfSet || !hasOwn(object, toStringTag2))) {
        if ($defineProperty) {
          $defineProperty(object, toStringTag2, {
            configurable: !nonConfigurable,
            enumerable: false,
            value,
            writable: false
          });
        } else {
          object[toStringTag2] = value;
        }
      }
    };
  }
});

// node_modules/form-data/lib/populate.js
var require_populate = __commonJS({
  "node_modules/form-data/lib/populate.js"(exports2, module2) {
    "use strict";
    module2.exports = function(dst, src) {
      Object.keys(src).forEach(function(prop) {
        dst[prop] = dst[prop] || src[prop];
      });
      return dst;
    };
  }
});

// node_modules/form-data/lib/form_data.js
var require_form_data = __commonJS({
  "node_modules/form-data/lib/form_data.js"(exports2, module2) {
    "use strict";
    var CombinedStream = require_combined_stream();
    var util4 = require("util");
    var path = require("path");
    var http7 = require("http");
    var https2 = require("https");
    var parseUrl2 = require("url").parse;
    var fs = require("fs");
    var Stream = require("stream").Stream;
    var crypto2 = require("crypto");
    var mime = require_mime_types();
    var asynckit = require_asynckit();
    var setToStringTag = require_es_set_tostringtag();
    var hasOwn = require_hasown();
    var populate = require_populate();
    function escapeHeaderParam(str) {
      return String(str).replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/"/g, "%22");
    }
    function FormData3(options) {
      if (!(this instanceof FormData3)) {
        return new FormData3(options);
      }
      this._overheadLength = 0;
      this._valueLength = 0;
      this._valuesToMeasure = [];
      CombinedStream.call(this);
      options = options || {};
      for (var option in options) {
        this[option] = options[option];
      }
    }
    util4.inherits(FormData3, CombinedStream);
    FormData3.LINE_BREAK = "\r\n";
    FormData3.DEFAULT_CONTENT_TYPE = "application/octet-stream";
    FormData3.prototype.append = function(field, value, options) {
      options = options || {};
      if (typeof options === "string") {
        options = { filename: options };
      }
      var append2 = CombinedStream.prototype.append.bind(this);
      if (typeof value === "number" || value == null) {
        value = String(value);
      }
      if (Array.isArray(value)) {
        this._error(new Error("Arrays are not supported."));
        return;
      }
      var header = this._multiPartHeader(field, value, options);
      var footer = this._multiPartFooter();
      append2(header);
      append2(value);
      append2(footer);
      this._trackLength(header, value, options);
    };
    FormData3.prototype._trackLength = function(header, value, options) {
      var valueLength = 0;
      if (options.knownLength != null) {
        valueLength += Number(options.knownLength);
      } else if (Buffer.isBuffer(value)) {
        valueLength = value.length;
      } else if (typeof value === "string") {
        valueLength = Buffer.byteLength(value);
      }
      this._valueLength += valueLength;
      this._overheadLength += Buffer.byteLength(header) + FormData3.LINE_BREAK.length;
      if (!value || !value.path && !(value.readable && hasOwn(value, "httpVersion")) && !(value instanceof Stream)) {
        return;
      }
      if (!options.knownLength) {
        this._valuesToMeasure.push(value);
      }
    };
    FormData3.prototype._lengthRetriever = function(value, callback) {
      if (hasOwn(value, "fd")) {
        if (value.end != void 0 && value.end != Infinity && value.start != void 0) {
          callback(null, value.end + 1 - (value.start ? value.start : 0));
        } else {
          fs.stat(value.path, function(err, stat) {
            if (err) {
              callback(err);
              return;
            }
            var fileSize = stat.size - (value.start ? value.start : 0);
            callback(null, fileSize);
          });
        }
      } else if (hasOwn(value, "httpVersion")) {
        callback(null, Number(value.headers["content-length"]));
      } else if (hasOwn(value, "httpModule")) {
        value.on("response", function(response) {
          value.pause();
          callback(null, Number(response.headers["content-length"]));
        });
        value.resume();
      } else {
        callback("Unknown stream");
      }
    };
    FormData3.prototype._multiPartHeader = function(field, value, options) {
      if (typeof options.header === "string") {
        return options.header;
      }
      var contentDisposition = this._getContentDisposition(value, options);
      var contentType = this._getContentType(value, options);
      var contents = "";
      var headers = {
        // add custom disposition as third element or keep it two elements if not
        "Content-Disposition": ["form-data", 'name="' + escapeHeaderParam(field) + '"'].concat(contentDisposition || []),
        // if no content type. allow it to be empty array
        "Content-Type": [].concat(contentType || [])
      };
      if (typeof options.header === "object") {
        populate(headers, options.header);
      }
      var header;
      for (var prop in headers) {
        if (hasOwn(headers, prop)) {
          header = headers[prop];
          if (header == null) {
            continue;
          }
          if (!Array.isArray(header)) {
            header = [header];
          }
          if (header.length) {
            contents += prop + ": " + header.join("; ") + FormData3.LINE_BREAK;
          }
        }
      }
      return "--" + this.getBoundary() + FormData3.LINE_BREAK + contents + FormData3.LINE_BREAK;
    };
    FormData3.prototype._getContentDisposition = function(value, options) {
      var filename;
      if (typeof options.filepath === "string") {
        filename = path.normalize(options.filepath).replace(/\\/g, "/");
      } else if (options.filename || value && (value.name || value.path)) {
        filename = path.basename(options.filename || value && (value.name || value.path));
      } else if (value && value.readable && hasOwn(value, "httpVersion")) {
        filename = path.basename(value.client._httpMessage.path || "");
      }
      if (filename) {
        return 'filename="' + escapeHeaderParam(filename) + '"';
      }
    };
    FormData3.prototype._getContentType = function(value, options) {
      var contentType = options.contentType;
      if (!contentType && value && value.name) {
        contentType = mime.lookup(value.name);
      }
      if (!contentType && value && value.path) {
        contentType = mime.lookup(value.path);
      }
      if (!contentType && value && value.readable && hasOwn(value, "httpVersion")) {
        contentType = value.headers["content-type"];
      }
      if (!contentType && (options.filepath || options.filename)) {
        contentType = mime.lookup(options.filepath || options.filename);
      }
      if (!contentType && value && typeof value === "object") {
        contentType = FormData3.DEFAULT_CONTENT_TYPE;
      }
      return contentType;
    };
    FormData3.prototype._multiPartFooter = function() {
      return function(next) {
        var footer = FormData3.LINE_BREAK;
        var lastPart = this._streams.length === 0;
        if (lastPart) {
          footer += this._lastBoundary();
        }
        next(footer);
      }.bind(this);
    };
    FormData3.prototype._lastBoundary = function() {
      return "--" + this.getBoundary() + "--" + FormData3.LINE_BREAK;
    };
    FormData3.prototype.getHeaders = function(userHeaders) {
      var header;
      var formHeaders = {
        "content-type": "multipart/form-data; boundary=" + this.getBoundary()
      };
      for (header in userHeaders) {
        if (hasOwn(userHeaders, header)) {
          formHeaders[header.toLowerCase()] = userHeaders[header];
        }
      }
      return formHeaders;
    };
    FormData3.prototype.setBoundary = function(boundary) {
      if (typeof boundary !== "string") {
        throw new TypeError("FormData boundary must be a string");
      }
      this._boundary = boundary;
    };
    FormData3.prototype.getBoundary = function() {
      if (!this._boundary) {
        this._generateBoundary();
      }
      return this._boundary;
    };
    FormData3.prototype.getBuffer = function() {
      var dataBuffer = new Buffer.alloc(0);
      var boundary = this.getBoundary();
      for (var i = 0, len = this._streams.length; i < len; i++) {
        if (typeof this._streams[i] !== "function") {
          if (Buffer.isBuffer(this._streams[i])) {
            dataBuffer = Buffer.concat([dataBuffer, this._streams[i]]);
          } else {
            dataBuffer = Buffer.concat([dataBuffer, Buffer.from(this._streams[i])]);
          }
          if (typeof this._streams[i] !== "string" || this._streams[i].substring(2, boundary.length + 2) !== boundary) {
            dataBuffer = Buffer.concat([dataBuffer, Buffer.from(FormData3.LINE_BREAK)]);
          }
        }
      }
      return Buffer.concat([dataBuffer, Buffer.from(this._lastBoundary())]);
    };
    FormData3.prototype._generateBoundary = function() {
      this._boundary = "--------------------------" + crypto2.randomBytes(12).toString("hex");
    };
    FormData3.prototype.getLengthSync = function() {
      var knownLength = this._overheadLength + this._valueLength;
      if (this._streams.length) {
        knownLength += this._lastBoundary().length;
      }
      if (!this.hasKnownLength()) {
        this._error(new Error("Cannot calculate proper length in synchronous way."));
      }
      return knownLength;
    };
    FormData3.prototype.hasKnownLength = function() {
      var hasKnownLength = true;
      if (this._valuesToMeasure.length) {
        hasKnownLength = false;
      }
      return hasKnownLength;
    };
    FormData3.prototype.getLength = function(cb) {
      var knownLength = this._overheadLength + this._valueLength;
      if (this._streams.length) {
        knownLength += this._lastBoundary().length;
      }
      if (!this._valuesToMeasure.length) {
        process.nextTick(cb.bind(this, null, knownLength));
        return;
      }
      asynckit.parallel(this._valuesToMeasure, this._lengthRetriever, function(err, values) {
        if (err) {
          cb(err);
          return;
        }
        values.forEach(function(length) {
          knownLength += length;
        });
        cb(null, knownLength);
      });
    };
    FormData3.prototype.submit = function(params, cb) {
      var request;
      var options;
      var defaults2 = { method: "post" };
      if (typeof params === "string") {
        params = parseUrl2(params);
        options = populate({
          port: params.port,
          path: params.pathname,
          host: params.hostname,
          protocol: params.protocol
        }, defaults2);
      } else {
        options = populate(params, defaults2);
        if (!options.port) {
          options.port = options.protocol === "https:" ? 443 : 80;
        }
      }
      options.headers = this.getHeaders(params.headers);
      if (options.protocol === "https:") {
        request = https2.request(options);
      } else {
        request = http7.request(options);
      }
      this.getLength(function(err, length) {
        if (err && err !== "Unknown stream") {
          this._error(err);
          return;
        }
        if (length) {
          request.setHeader("Content-Length", length);
        }
        this.pipe(request);
        if (cb) {
          var onResponse;
          var callback = function(error, responce) {
            request.removeListener("error", callback);
            request.removeListener("response", onResponse);
            return cb.call(this, error, responce);
          };
          onResponse = callback.bind(this, null);
          request.on("error", callback);
          request.on("response", onResponse);
        }
      }.bind(this));
      return request;
    };
    FormData3.prototype._error = function(err) {
      if (!this.error) {
        this.error = err;
        this.pause();
        this.emit("error", err);
      }
    };
    FormData3.prototype.toString = function() {
      return "[object FormData]";
    };
    setToStringTag(FormData3.prototype, "FormData");
    module2.exports = FormData3;
  }
});

// node_modules/ms/index.js
var require_ms = __commonJS({
  "node_modules/ms/index.js"(exports2, module2) {
    var s = 1e3;
    var m = s * 60;
    var h = m * 60;
    var d = h * 24;
    var w = d * 7;
    var y = d * 365.25;
    module2.exports = function(val, options) {
      options = options || {};
      var type = typeof val;
      if (type === "string" && val.length > 0) {
        return parse(val);
      } else if (type === "number" && isFinite(val)) {
        return options.long ? fmtLong(val) : fmtShort(val);
      }
      throw new Error(
        "val is not a non-empty string or a valid number. val=" + JSON.stringify(val)
      );
    };
    function parse(str) {
      str = String(str);
      if (str.length > 100) {
        return;
      }
      var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
        str
      );
      if (!match) {
        return;
      }
      var n = parseFloat(match[1]);
      var type = (match[2] || "ms").toLowerCase();
      switch (type) {
        case "years":
        case "year":
        case "yrs":
        case "yr":
        case "y":
          return n * y;
        case "weeks":
        case "week":
        case "w":
          return n * w;
        case "days":
        case "day":
        case "d":
          return n * d;
        case "hours":
        case "hour":
        case "hrs":
        case "hr":
        case "h":
          return n * h;
        case "minutes":
        case "minute":
        case "mins":
        case "min":
        case "m":
          return n * m;
        case "seconds":
        case "second":
        case "secs":
        case "sec":
        case "s":
          return n * s;
        case "milliseconds":
        case "millisecond":
        case "msecs":
        case "msec":
        case "ms":
          return n;
        default:
          return void 0;
      }
    }
    function fmtShort(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return Math.round(ms / d) + "d";
      }
      if (msAbs >= h) {
        return Math.round(ms / h) + "h";
      }
      if (msAbs >= m) {
        return Math.round(ms / m) + "m";
      }
      if (msAbs >= s) {
        return Math.round(ms / s) + "s";
      }
      return ms + "ms";
    }
    function fmtLong(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return plural(ms, msAbs, d, "day");
      }
      if (msAbs >= h) {
        return plural(ms, msAbs, h, "hour");
      }
      if (msAbs >= m) {
        return plural(ms, msAbs, m, "minute");
      }
      if (msAbs >= s) {
        return plural(ms, msAbs, s, "second");
      }
      return ms + " ms";
    }
    function plural(ms, msAbs, n, name) {
      var isPlural = msAbs >= n * 1.5;
      return Math.round(ms / n) + " " + name + (isPlural ? "s" : "");
    }
  }
});

// node_modules/debug/src/common.js
var require_common = __commonJS({
  "node_modules/debug/src/common.js"(exports2, module2) {
    function setup(env) {
      createDebug.debug = createDebug;
      createDebug.default = createDebug;
      createDebug.coerce = coerce;
      createDebug.disable = disable;
      createDebug.enable = enable;
      createDebug.enabled = enabled;
      createDebug.humanize = require_ms();
      createDebug.destroy = destroy;
      Object.keys(env).forEach((key) => {
        createDebug[key] = env[key];
      });
      createDebug.names = [];
      createDebug.skips = [];
      createDebug.formatters = {};
      function selectColor(namespace) {
        let hash = 0;
        for (let i = 0; i < namespace.length; i++) {
          hash = (hash << 5) - hash + namespace.charCodeAt(i);
          hash |= 0;
        }
        return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
      }
      createDebug.selectColor = selectColor;
      function createDebug(namespace) {
        let prevTime;
        let enableOverride = null;
        let namespacesCache;
        let enabledCache;
        function debug(...args) {
          if (!debug.enabled) {
            return;
          }
          const self2 = debug;
          const curr = Number(/* @__PURE__ */ new Date());
          const ms = curr - (prevTime || curr);
          self2.diff = ms;
          self2.prev = prevTime;
          self2.curr = curr;
          prevTime = curr;
          args[0] = createDebug.coerce(args[0]);
          if (typeof args[0] !== "string") {
            args.unshift("%O");
          }
          let index = 0;
          args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
            if (match === "%%") {
              return "%";
            }
            index++;
            const formatter = createDebug.formatters[format];
            if (typeof formatter === "function") {
              const val = args[index];
              match = formatter.call(self2, val);
              args.splice(index, 1);
              index--;
            }
            return match;
          });
          createDebug.formatArgs.call(self2, args);
          const logFn = self2.log || createDebug.log;
          logFn.apply(self2, args);
        }
        debug.namespace = namespace;
        debug.useColors = createDebug.useColors();
        debug.color = createDebug.selectColor(namespace);
        debug.extend = extend2;
        debug.destroy = createDebug.destroy;
        Object.defineProperty(debug, "enabled", {
          enumerable: true,
          configurable: false,
          get: () => {
            if (enableOverride !== null) {
              return enableOverride;
            }
            if (namespacesCache !== createDebug.namespaces) {
              namespacesCache = createDebug.namespaces;
              enabledCache = createDebug.enabled(namespace);
            }
            return enabledCache;
          },
          set: (v) => {
            enableOverride = v;
          }
        });
        if (typeof createDebug.init === "function") {
          createDebug.init(debug);
        }
        return debug;
      }
      function extend2(namespace, delimiter) {
        const newDebug = createDebug(this.namespace + (typeof delimiter === "undefined" ? ":" : delimiter) + namespace);
        newDebug.log = this.log;
        return newDebug;
      }
      function enable(namespaces) {
        createDebug.save(namespaces);
        createDebug.namespaces = namespaces;
        createDebug.names = [];
        createDebug.skips = [];
        const split = (typeof namespaces === "string" ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
        for (const ns of split) {
          if (ns[0] === "-") {
            createDebug.skips.push(ns.slice(1));
          } else {
            createDebug.names.push(ns);
          }
        }
      }
      function matchesTemplate(search, template) {
        let searchIndex = 0;
        let templateIndex = 0;
        let starIndex = -1;
        let matchIndex = 0;
        while (searchIndex < search.length) {
          if (templateIndex < template.length && (template[templateIndex] === search[searchIndex] || template[templateIndex] === "*")) {
            if (template[templateIndex] === "*") {
              starIndex = templateIndex;
              matchIndex = searchIndex;
              templateIndex++;
            } else {
              searchIndex++;
              templateIndex++;
            }
          } else if (starIndex !== -1) {
            templateIndex = starIndex + 1;
            matchIndex++;
            searchIndex = matchIndex;
          } else {
            return false;
          }
        }
        while (templateIndex < template.length && template[templateIndex] === "*") {
          templateIndex++;
        }
        return templateIndex === template.length;
      }
      function disable() {
        const namespaces = [
          ...createDebug.names,
          ...createDebug.skips.map((namespace) => "-" + namespace)
        ].join(",");
        createDebug.enable("");
        return namespaces;
      }
      function enabled(name) {
        for (const skip of createDebug.skips) {
          if (matchesTemplate(name, skip)) {
            return false;
          }
        }
        for (const ns of createDebug.names) {
          if (matchesTemplate(name, ns)) {
            return true;
          }
        }
        return false;
      }
      function coerce(val) {
        if (val instanceof Error) {
          return val.stack || val.message;
        }
        return val;
      }
      function destroy() {
        console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
      }
      createDebug.enable(createDebug.load());
      return createDebug;
    }
    module2.exports = setup;
  }
});

// node_modules/debug/src/browser.js
var require_browser = __commonJS({
  "node_modules/debug/src/browser.js"(exports2, module2) {
    exports2.formatArgs = formatArgs;
    exports2.save = save;
    exports2.load = load;
    exports2.useColors = useColors;
    exports2.storage = localstorage();
    exports2.destroy = /* @__PURE__ */ (() => {
      let warned = false;
      return () => {
        if (!warned) {
          warned = true;
          console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
        }
      };
    })();
    exports2.colors = [
      "#0000CC",
      "#0000FF",
      "#0033CC",
      "#0033FF",
      "#0066CC",
      "#0066FF",
      "#0099CC",
      "#0099FF",
      "#00CC00",
      "#00CC33",
      "#00CC66",
      "#00CC99",
      "#00CCCC",
      "#00CCFF",
      "#3300CC",
      "#3300FF",
      "#3333CC",
      "#3333FF",
      "#3366CC",
      "#3366FF",
      "#3399CC",
      "#3399FF",
      "#33CC00",
      "#33CC33",
      "#33CC66",
      "#33CC99",
      "#33CCCC",
      "#33CCFF",
      "#6600CC",
      "#6600FF",
      "#6633CC",
      "#6633FF",
      "#66CC00",
      "#66CC33",
      "#9900CC",
      "#9900FF",
      "#9933CC",
      "#9933FF",
      "#99CC00",
      "#99CC33",
      "#CC0000",
      "#CC0033",
      "#CC0066",
      "#CC0099",
      "#CC00CC",
      "#CC00FF",
      "#CC3300",
      "#CC3333",
      "#CC3366",
      "#CC3399",
      "#CC33CC",
      "#CC33FF",
      "#CC6600",
      "#CC6633",
      "#CC9900",
      "#CC9933",
      "#CCCC00",
      "#CCCC33",
      "#FF0000",
      "#FF0033",
      "#FF0066",
      "#FF0099",
      "#FF00CC",
      "#FF00FF",
      "#FF3300",
      "#FF3333",
      "#FF3366",
      "#FF3399",
      "#FF33CC",
      "#FF33FF",
      "#FF6600",
      "#FF6633",
      "#FF9900",
      "#FF9933",
      "#FFCC00",
      "#FFCC33"
    ];
    function useColors() {
      if (typeof window !== "undefined" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) {
        return true;
      }
      if (typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
        return false;
      }
      let m;
      return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // Is firebug? http://stackoverflow.com/a/398120/376773
      typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || // Is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      typeof navigator !== "undefined" && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || // Double check webkit in userAgent just in case we are in a worker
      typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
    }
    function formatArgs(args) {
      args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module2.exports.humanize(this.diff);
      if (!this.useColors) {
        return;
      }
      const c = "color: " + this.color;
      args.splice(1, 0, c, "color: inherit");
      let index = 0;
      let lastC = 0;
      args[0].replace(/%[a-zA-Z%]/g, (match) => {
        if (match === "%%") {
          return;
        }
        index++;
        if (match === "%c") {
          lastC = index;
        }
      });
      args.splice(lastC, 0, c);
    }
    exports2.log = console.debug || console.log || (() => {
    });
    function save(namespaces) {
      try {
        if (namespaces) {
          exports2.storage.setItem("debug", namespaces);
        } else {
          exports2.storage.removeItem("debug");
        }
      } catch (error) {
      }
    }
    function load() {
      let r;
      try {
        r = exports2.storage.getItem("debug") || exports2.storage.getItem("DEBUG");
      } catch (error) {
      }
      if (!r && typeof process !== "undefined" && "env" in process) {
        r = process.env.DEBUG;
      }
      return r;
    }
    function localstorage() {
      try {
        return localStorage;
      } catch (error) {
      }
    }
    module2.exports = require_common()(exports2);
    var { formatters } = module2.exports;
    formatters.j = function(v) {
      try {
        return JSON.stringify(v);
      } catch (error) {
        return "[UnexpectedJSONParseError]: " + error.message;
      }
    };
  }
});

// node_modules/has-flag/index.js
var require_has_flag = __commonJS({
  "node_modules/has-flag/index.js"(exports2, module2) {
    "use strict";
    module2.exports = (flag, argv = process.argv) => {
      const prefix = flag.startsWith("-") ? "" : flag.length === 1 ? "-" : "--";
      const position = argv.indexOf(prefix + flag);
      const terminatorPosition = argv.indexOf("--");
      return position !== -1 && (terminatorPosition === -1 || position < terminatorPosition);
    };
  }
});

// node_modules/supports-color/index.js
var require_supports_color = __commonJS({
  "node_modules/supports-color/index.js"(exports2, module2) {
    "use strict";
    var os = require("os");
    var tty = require("tty");
    var hasFlag = require_has_flag();
    var { env } = process;
    var forceColor;
    if (hasFlag("no-color") || hasFlag("no-colors") || hasFlag("color=false") || hasFlag("color=never")) {
      forceColor = 0;
    } else if (hasFlag("color") || hasFlag("colors") || hasFlag("color=true") || hasFlag("color=always")) {
      forceColor = 1;
    }
    if ("FORCE_COLOR" in env) {
      if (env.FORCE_COLOR === "true") {
        forceColor = 1;
      } else if (env.FORCE_COLOR === "false") {
        forceColor = 0;
      } else {
        forceColor = env.FORCE_COLOR.length === 0 ? 1 : Math.min(parseInt(env.FORCE_COLOR, 10), 3);
      }
    }
    function translateLevel(level) {
      if (level === 0) {
        return false;
      }
      return {
        level,
        hasBasic: true,
        has256: level >= 2,
        has16m: level >= 3
      };
    }
    function supportsColor(haveStream, streamIsTTY) {
      if (forceColor === 0) {
        return 0;
      }
      if (hasFlag("color=16m") || hasFlag("color=full") || hasFlag("color=truecolor")) {
        return 3;
      }
      if (hasFlag("color=256")) {
        return 2;
      }
      if (haveStream && !streamIsTTY && forceColor === void 0) {
        return 0;
      }
      const min = forceColor || 0;
      if (env.TERM === "dumb") {
        return min;
      }
      if (process.platform === "win32") {
        const osRelease = os.release().split(".");
        if (Number(osRelease[0]) >= 10 && Number(osRelease[2]) >= 10586) {
          return Number(osRelease[2]) >= 14931 ? 3 : 2;
        }
        return 1;
      }
      if ("CI" in env) {
        if (["TRAVIS", "CIRCLECI", "APPVEYOR", "GITLAB_CI", "GITHUB_ACTIONS", "BUILDKITE"].some((sign) => sign in env) || env.CI_NAME === "codeship") {
          return 1;
        }
        return min;
      }
      if ("TEAMCITY_VERSION" in env) {
        return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
      }
      if (env.COLORTERM === "truecolor") {
        return 3;
      }
      if ("TERM_PROGRAM" in env) {
        const version = parseInt((env.TERM_PROGRAM_VERSION || "").split(".")[0], 10);
        switch (env.TERM_PROGRAM) {
          case "iTerm.app":
            return version >= 3 ? 3 : 2;
          case "Apple_Terminal":
            return 2;
        }
      }
      if (/-256(color)?$/i.test(env.TERM)) {
        return 2;
      }
      if (/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) {
        return 1;
      }
      if ("COLORTERM" in env) {
        return 1;
      }
      return min;
    }
    function getSupportLevel(stream4) {
      const level = supportsColor(stream4, stream4 && stream4.isTTY);
      return translateLevel(level);
    }
    module2.exports = {
      supportsColor: getSupportLevel,
      stdout: translateLevel(supportsColor(true, tty.isatty(1))),
      stderr: translateLevel(supportsColor(true, tty.isatty(2)))
    };
  }
});

// node_modules/debug/src/node.js
var require_node = __commonJS({
  "node_modules/debug/src/node.js"(exports2, module2) {
    var tty = require("tty");
    var util4 = require("util");
    exports2.init = init;
    exports2.log = log;
    exports2.formatArgs = formatArgs;
    exports2.save = save;
    exports2.load = load;
    exports2.useColors = useColors;
    exports2.destroy = util4.deprecate(
      () => {
      },
      "Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."
    );
    exports2.colors = [6, 2, 3, 4, 5, 1];
    try {
      const supportsColor = require_supports_color();
      if (supportsColor && (supportsColor.stderr || supportsColor).level >= 2) {
        exports2.colors = [
          20,
          21,
          26,
          27,
          32,
          33,
          38,
          39,
          40,
          41,
          42,
          43,
          44,
          45,
          56,
          57,
          62,
          63,
          68,
          69,
          74,
          75,
          76,
          77,
          78,
          79,
          80,
          81,
          92,
          93,
          98,
          99,
          112,
          113,
          128,
          129,
          134,
          135,
          148,
          149,
          160,
          161,
          162,
          163,
          164,
          165,
          166,
          167,
          168,
          169,
          170,
          171,
          172,
          173,
          178,
          179,
          184,
          185,
          196,
          197,
          198,
          199,
          200,
          201,
          202,
          203,
          204,
          205,
          206,
          207,
          208,
          209,
          214,
          215,
          220,
          221
        ];
      }
    } catch (error) {
    }
    exports2.inspectOpts = Object.keys(process.env).filter((key) => {
      return /^debug_/i.test(key);
    }).reduce((obj, key) => {
      const prop = key.substring(6).toLowerCase().replace(/_([a-z])/g, (_, k) => {
        return k.toUpperCase();
      });
      let val = process.env[key];
      if (/^(yes|on|true|enabled)$/i.test(val)) {
        val = true;
      } else if (/^(no|off|false|disabled)$/i.test(val)) {
        val = false;
      } else if (val === "null") {
        val = null;
      } else {
        val = Number(val);
      }
      obj[prop] = val;
      return obj;
    }, {});
    function useColors() {
      return "colors" in exports2.inspectOpts ? Boolean(exports2.inspectOpts.colors) : tty.isatty(process.stderr.fd);
    }
    function formatArgs(args) {
      const { namespace: name, useColors: useColors2 } = this;
      if (useColors2) {
        const c = this.color;
        const colorCode = "\x1B[3" + (c < 8 ? c : "8;5;" + c);
        const prefix = `  ${colorCode};1m${name} \x1B[0m`;
        args[0] = prefix + args[0].split("\n").join("\n" + prefix);
        args.push(colorCode + "m+" + module2.exports.humanize(this.diff) + "\x1B[0m");
      } else {
        args[0] = getDate() + name + " " + args[0];
      }
    }
    function getDate() {
      if (exports2.inspectOpts.hideDate) {
        return "";
      }
      return (/* @__PURE__ */ new Date()).toISOString() + " ";
    }
    function log(...args) {
      return process.stderr.write(util4.formatWithOptions(exports2.inspectOpts, ...args) + "\n");
    }
    function save(namespaces) {
      if (namespaces) {
        process.env.DEBUG = namespaces;
      } else {
        delete process.env.DEBUG;
      }
    }
    function load() {
      return process.env.DEBUG;
    }
    function init(debug) {
      debug.inspectOpts = {};
      const keys = Object.keys(exports2.inspectOpts);
      for (let i = 0; i < keys.length; i++) {
        debug.inspectOpts[keys[i]] = exports2.inspectOpts[keys[i]];
      }
    }
    module2.exports = require_common()(exports2);
    var { formatters } = module2.exports;
    formatters.o = function(v) {
      this.inspectOpts.colors = this.useColors;
      return util4.inspect(v, this.inspectOpts).split("\n").map((str) => str.trim()).join(" ");
    };
    formatters.O = function(v) {
      this.inspectOpts.colors = this.useColors;
      return util4.inspect(v, this.inspectOpts);
    };
  }
});

// node_modules/debug/src/index.js
var require_src = __commonJS({
  "node_modules/debug/src/index.js"(exports2, module2) {
    if (typeof process === "undefined" || process.type === "renderer" || process.browser === true || process.__nwjs) {
      module2.exports = require_browser();
    } else {
      module2.exports = require_node();
    }
  }
});

// node_modules/agent-base/dist/src/promisify.js
var require_promisify = __commonJS({
  "node_modules/agent-base/dist/src/promisify.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    function promisify(fn) {
      return function(req, opts) {
        return new Promise((resolve, reject) => {
          fn.call(this, req, opts, (err, rtn) => {
            if (err) {
              reject(err);
            } else {
              resolve(rtn);
            }
          });
        });
      };
    }
    exports2.default = promisify;
  }
});

// node_modules/agent-base/dist/src/index.js
var require_src2 = __commonJS({
  "node_modules/agent-base/dist/src/index.js"(exports2, module2) {
    "use strict";
    var __importDefault = exports2 && exports2.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    var events_1 = require("events");
    var debug_1 = __importDefault(require_src());
    var promisify_1 = __importDefault(require_promisify());
    var debug = debug_1.default("agent-base");
    function isAgent(v) {
      return Boolean(v) && typeof v.addRequest === "function";
    }
    function isSecureEndpoint() {
      const { stack } = new Error();
      if (typeof stack !== "string")
        return false;
      return stack.split("\n").some((l) => l.indexOf("(https.js:") !== -1 || l.indexOf("node:https:") !== -1);
    }
    function createAgent(callback, opts) {
      return new createAgent.Agent(callback, opts);
    }
    (function(createAgent2) {
      class Agent extends events_1.EventEmitter {
        constructor(callback, _opts) {
          super();
          let opts = _opts;
          if (typeof callback === "function") {
            this.callback = callback;
          } else if (callback) {
            opts = callback;
          }
          this.timeout = null;
          if (opts && typeof opts.timeout === "number") {
            this.timeout = opts.timeout;
          }
          this.maxFreeSockets = 1;
          this.maxSockets = 1;
          this.maxTotalSockets = Infinity;
          this.sockets = {};
          this.freeSockets = {};
          this.requests = {};
          this.options = {};
        }
        get defaultPort() {
          if (typeof this.explicitDefaultPort === "number") {
            return this.explicitDefaultPort;
          }
          return isSecureEndpoint() ? 443 : 80;
        }
        set defaultPort(v) {
          this.explicitDefaultPort = v;
        }
        get protocol() {
          if (typeof this.explicitProtocol === "string") {
            return this.explicitProtocol;
          }
          return isSecureEndpoint() ? "https:" : "http:";
        }
        set protocol(v) {
          this.explicitProtocol = v;
        }
        callback(req, opts, fn) {
          throw new Error('"agent-base" has no default implementation, you must subclass and override `callback()`');
        }
        /**
         * Called by node-core's "_http_client.js" module when creating
         * a new HTTP request with this Agent instance.
         *
         * @api public
         */
        addRequest(req, _opts) {
          const opts = Object.assign({}, _opts);
          if (typeof opts.secureEndpoint !== "boolean") {
            opts.secureEndpoint = isSecureEndpoint();
          }
          if (opts.host == null) {
            opts.host = "localhost";
          }
          if (opts.port == null) {
            opts.port = opts.secureEndpoint ? 443 : 80;
          }
          if (opts.protocol == null) {
            opts.protocol = opts.secureEndpoint ? "https:" : "http:";
          }
          if (opts.host && opts.path) {
            delete opts.path;
          }
          delete opts.agent;
          delete opts.hostname;
          delete opts._defaultAgent;
          delete opts.defaultPort;
          delete opts.createConnection;
          req._last = true;
          req.shouldKeepAlive = false;
          let timedOut = false;
          let timeoutId = null;
          const timeoutMs = opts.timeout || this.timeout;
          const onerror = (err) => {
            if (req._hadError)
              return;
            req.emit("error", err);
            req._hadError = true;
          };
          const ontimeout = () => {
            timeoutId = null;
            timedOut = true;
            const err = new Error(`A "socket" was not created for HTTP request before ${timeoutMs}ms`);
            err.code = "ETIMEOUT";
            onerror(err);
          };
          const callbackError = (err) => {
            if (timedOut)
              return;
            if (timeoutId !== null) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            onerror(err);
          };
          const onsocket = (socket) => {
            if (timedOut)
              return;
            if (timeoutId != null) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            if (isAgent(socket)) {
              debug("Callback returned another Agent instance %o", socket.constructor.name);
              socket.addRequest(req, opts);
              return;
            }
            if (socket) {
              socket.once("free", () => {
                this.freeSocket(socket, opts);
              });
              req.onSocket(socket);
              return;
            }
            const err = new Error(`no Duplex stream was returned to agent-base for \`${req.method} ${req.path}\``);
            onerror(err);
          };
          if (typeof this.callback !== "function") {
            onerror(new Error("`callback` is not defined"));
            return;
          }
          if (!this.promisifiedCallback) {
            if (this.callback.length >= 3) {
              debug("Converting legacy callback function to promise");
              this.promisifiedCallback = promisify_1.default(this.callback);
            } else {
              this.promisifiedCallback = this.callback;
            }
          }
          if (typeof timeoutMs === "number" && timeoutMs > 0) {
            timeoutId = setTimeout(ontimeout, timeoutMs);
          }
          if ("port" in opts && typeof opts.port !== "number") {
            opts.port = Number(opts.port);
          }
          try {
            debug("Resolving socket for %o request: %o", opts.protocol, `${req.method} ${req.path}`);
            Promise.resolve(this.promisifiedCallback(req, opts)).then(onsocket, callbackError);
          } catch (err) {
            Promise.reject(err).catch(callbackError);
          }
        }
        freeSocket(socket, opts) {
          debug("Freeing socket %o %o", socket.constructor.name, opts);
          socket.destroy();
        }
        destroy() {
          debug("Destroying agent %o", this.constructor.name);
        }
      }
      createAgent2.Agent = Agent;
      createAgent2.prototype = createAgent2.Agent.prototype;
    })(createAgent || (createAgent = {}));
    module2.exports = createAgent;
  }
});

// node_modules/https-proxy-agent/dist/parse-proxy-response.js
var require_parse_proxy_response = __commonJS({
  "node_modules/https-proxy-agent/dist/parse-proxy-response.js"(exports2) {
    "use strict";
    var __importDefault = exports2 && exports2.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    var debug_1 = __importDefault(require_src());
    var debug = debug_1.default("https-proxy-agent:parse-proxy-response");
    function parseProxyResponse(socket) {
      return new Promise((resolve, reject) => {
        let buffersLength = 0;
        const buffers = [];
        function read() {
          const b = socket.read();
          if (b)
            ondata(b);
          else
            socket.once("readable", read);
        }
        function cleanup() {
          socket.removeListener("end", onend);
          socket.removeListener("error", onerror);
          socket.removeListener("close", onclose);
          socket.removeListener("readable", read);
        }
        function onclose(err) {
          debug("onclose had error %o", err);
        }
        function onend() {
          debug("onend");
        }
        function onerror(err) {
          cleanup();
          debug("onerror %o", err);
          reject(err);
        }
        function ondata(b) {
          buffers.push(b);
          buffersLength += b.length;
          const buffered = Buffer.concat(buffers, buffersLength);
          const endOfHeaders = buffered.indexOf("\r\n\r\n");
          if (endOfHeaders === -1) {
            debug("have not received end of HTTP headers yet...");
            read();
            return;
          }
          const firstLine = buffered.toString("ascii", 0, buffered.indexOf("\r\n"));
          const statusCode = +firstLine.split(" ")[1];
          debug("got proxy server response: %o", firstLine);
          resolve({
            statusCode,
            buffered
          });
        }
        socket.on("error", onerror);
        socket.on("close", onclose);
        socket.on("end", onend);
        read();
      });
    }
    exports2.default = parseProxyResponse;
  }
});

// node_modules/https-proxy-agent/dist/agent.js
var require_agent = __commonJS({
  "node_modules/https-proxy-agent/dist/agent.js"(exports2) {
    "use strict";
    var __awaiter = exports2 && exports2.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        function step(result) {
          result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
        }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    var __importDefault = exports2 && exports2.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    var net_1 = __importDefault(require("net"));
    var tls_1 = __importDefault(require("tls"));
    var url_1 = __importDefault(require("url"));
    var assert_1 = __importDefault(require("assert"));
    var debug_1 = __importDefault(require_src());
    var agent_base_1 = require_src2();
    var parse_proxy_response_1 = __importDefault(require_parse_proxy_response());
    var debug = debug_1.default("https-proxy-agent:agent");
    var HttpsProxyAgent2 = class extends agent_base_1.Agent {
      constructor(_opts) {
        let opts;
        if (typeof _opts === "string") {
          opts = url_1.default.parse(_opts);
        } else {
          opts = _opts;
        }
        if (!opts) {
          throw new Error("an HTTP(S) proxy server `host` and `port` must be specified!");
        }
        debug("creating new HttpsProxyAgent instance: %o", opts);
        super(opts);
        const proxy = Object.assign({}, opts);
        this.secureProxy = opts.secureProxy || isHTTPS(proxy.protocol);
        proxy.host = proxy.hostname || proxy.host;
        if (typeof proxy.port === "string") {
          proxy.port = parseInt(proxy.port, 10);
        }
        if (!proxy.port && proxy.host) {
          proxy.port = this.secureProxy ? 443 : 80;
        }
        if (this.secureProxy && !("ALPNProtocols" in proxy)) {
          proxy.ALPNProtocols = ["http 1.1"];
        }
        if (proxy.host && proxy.path) {
          delete proxy.path;
          delete proxy.pathname;
        }
        this.proxy = proxy;
      }
      /**
       * Called when the node-core HTTP client library is creating a
       * new HTTP request.
       *
       * @api protected
       */
      callback(req, opts) {
        return __awaiter(this, void 0, void 0, function* () {
          const { proxy, secureProxy } = this;
          let socket;
          if (secureProxy) {
            debug("Creating `tls.Socket`: %o", proxy);
            socket = tls_1.default.connect(proxy);
          } else {
            debug("Creating `net.Socket`: %o", proxy);
            socket = net_1.default.connect(proxy);
          }
          const headers = Object.assign({}, proxy.headers);
          const hostname = `${opts.host}:${opts.port}`;
          let payload = `CONNECT ${hostname} HTTP/1.1\r
`;
          if (proxy.auth) {
            headers["Proxy-Authorization"] = `Basic ${Buffer.from(proxy.auth).toString("base64")}`;
          }
          let { host, port, secureEndpoint } = opts;
          if (!isDefaultPort(port, secureEndpoint)) {
            host += `:${port}`;
          }
          headers.Host = host;
          headers.Connection = "close";
          for (const name of Object.keys(headers)) {
            payload += `${name}: ${headers[name]}\r
`;
          }
          const proxyResponsePromise = parse_proxy_response_1.default(socket);
          socket.write(`${payload}\r
`);
          const { statusCode, buffered } = yield proxyResponsePromise;
          if (statusCode === 200) {
            req.once("socket", resume);
            if (opts.secureEndpoint) {
              debug("Upgrading socket connection to TLS");
              const servername = opts.servername || opts.host;
              return tls_1.default.connect(Object.assign(Object.assign({}, omit(opts, "host", "hostname", "path", "port")), {
                socket,
                servername
              }));
            }
            return socket;
          }
          socket.destroy();
          const fakeSocket = new net_1.default.Socket({ writable: false });
          fakeSocket.readable = true;
          req.once("socket", (s) => {
            debug("replaying proxy buffer for failed request");
            assert_1.default(s.listenerCount("data") > 0);
            s.push(buffered);
            s.push(null);
          });
          return fakeSocket;
        });
      }
    };
    exports2.default = HttpsProxyAgent2;
    function resume(socket) {
      socket.resume();
    }
    function isDefaultPort(port, secure) {
      return Boolean(!secure && port === 80 || secure && port === 443);
    }
    function isHTTPS(protocol) {
      return typeof protocol === "string" ? /^https:?$/i.test(protocol) : false;
    }
    function omit(obj, ...keys) {
      const ret = {};
      let key;
      for (key in obj) {
        if (!keys.includes(key)) {
          ret[key] = obj[key];
        }
      }
      return ret;
    }
  }
});

// node_modules/https-proxy-agent/dist/index.js
var require_dist = __commonJS({
  "node_modules/https-proxy-agent/dist/index.js"(exports2, module2) {
    "use strict";
    var __importDefault = exports2 && exports2.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    var agent_1 = __importDefault(require_agent());
    function createHttpsProxyAgent(opts) {
      return new agent_1.default(opts);
    }
    (function(createHttpsProxyAgent2) {
      createHttpsProxyAgent2.HttpsProxyAgent = agent_1.default;
      createHttpsProxyAgent2.prototype = agent_1.default.prototype;
    })(createHttpsProxyAgent || (createHttpsProxyAgent = {}));
    module2.exports = createHttpsProxyAgent;
  }
});

// node_modules/follow-redirects/debug.js
var require_debug = __commonJS({
  "node_modules/follow-redirects/debug.js"(exports2, module2) {
    var debug;
    module2.exports = function() {
      if (!debug) {
        try {
          debug = require_src()("follow-redirects");
        } catch (error) {
        }
        if (typeof debug !== "function") {
          debug = function() {
          };
        }
      }
      debug.apply(null, arguments);
    };
  }
});

// node_modules/follow-redirects/index.js
var require_follow_redirects = __commonJS({
  "node_modules/follow-redirects/index.js"(exports2, module2) {
    var url2 = require("url");
    var URL2 = url2.URL;
    var http7 = require("http");
    var https2 = require("https");
    var Writable = require("stream").Writable;
    var assert = require("assert");
    var debug = require_debug();
    (function detectUnsupportedEnvironment() {
      var looksLikeNode = typeof process !== "undefined";
      var looksLikeBrowser = typeof window !== "undefined" && typeof document !== "undefined";
      var looksLikeV8 = isFunction3(Error.captureStackTrace);
      if (!looksLikeNode && (looksLikeBrowser || !looksLikeV8)) {
        console.warn("The follow-redirects package should be excluded from browser builds.");
      }
    })();
    var useNativeURL = false;
    try {
      assert(new URL2(""));
    } catch (error) {
      useNativeURL = error.code === "ERR_INVALID_URL";
    }
    var sensitiveHeaders = [
      "Authorization",
      "Proxy-Authorization",
      "Cookie"
    ];
    var preservedUrlFields = [
      "auth",
      "host",
      "hostname",
      "href",
      "path",
      "pathname",
      "port",
      "protocol",
      "query",
      "search",
      "hash"
    ];
    var events2 = ["abort", "aborted", "connect", "error", "socket", "timeout"];
    var eventHandlers = /* @__PURE__ */ Object.create(null);
    events2.forEach(function(event) {
      eventHandlers[event] = function(arg1, arg2, arg3) {
        this._redirectable.emit(event, arg1, arg2, arg3);
      };
    });
    var InvalidUrlError = createErrorType(
      "ERR_INVALID_URL",
      "Invalid URL",
      TypeError
    );
    var RedirectionError = createErrorType(
      "ERR_FR_REDIRECTION_FAILURE",
      "Redirected request failed"
    );
    var TooManyRedirectsError = createErrorType(
      "ERR_FR_TOO_MANY_REDIRECTS",
      "Maximum number of redirects exceeded",
      RedirectionError
    );
    var MaxBodyLengthExceededError = createErrorType(
      "ERR_FR_MAX_BODY_LENGTH_EXCEEDED",
      "Request body larger than maxBodyLength limit"
    );
    var WriteAfterEndError = createErrorType(
      "ERR_STREAM_WRITE_AFTER_END",
      "write after end"
    );
    var destroy = Writable.prototype.destroy || noop2;
    function RedirectableRequest(options, responseCallback) {
      Writable.call(this);
      this._sanitizeOptions(options);
      this._options = options;
      this._ended = false;
      this._ending = false;
      this._redirectCount = 0;
      this._redirects = [];
      this._requestBodyLength = 0;
      this._requestBodyBuffers = [];
      if (responseCallback) {
        this.on("response", responseCallback);
      }
      var self2 = this;
      this._onNativeResponse = function(response) {
        try {
          self2._processResponse(response);
        } catch (cause) {
          self2.emit("error", cause instanceof RedirectionError ? cause : new RedirectionError({ cause }));
        }
      };
      this._headerFilter = new RegExp("^(?:" + sensitiveHeaders.concat(options.sensitiveHeaders).map(escapeRegex).join("|") + ")$", "i");
      this._performRequest();
    }
    RedirectableRequest.prototype = Object.create(Writable.prototype);
    RedirectableRequest.prototype.abort = function() {
      destroyRequest(this._currentRequest);
      this._currentRequest.abort();
      this.emit("abort");
    };
    RedirectableRequest.prototype.destroy = function(error) {
      destroyRequest(this._currentRequest, error);
      destroy.call(this, error);
      return this;
    };
    RedirectableRequest.prototype.write = function(data, encoding, callback) {
      if (this._ending) {
        throw new WriteAfterEndError();
      }
      if (!isString2(data) && !isBuffer2(data)) {
        throw new TypeError("data should be a string, Buffer or Uint8Array");
      }
      if (isFunction3(encoding)) {
        callback = encoding;
        encoding = null;
      }
      if (data.length === 0) {
        if (callback) {
          callback();
        }
        return;
      }
      if (this._requestBodyLength + data.length <= this._options.maxBodyLength) {
        this._requestBodyLength += data.length;
        this._requestBodyBuffers.push({ data, encoding });
        this._currentRequest.write(data, encoding, callback);
      } else {
        this.emit("error", new MaxBodyLengthExceededError());
        this.abort();
      }
    };
    RedirectableRequest.prototype.end = function(data, encoding, callback) {
      if (isFunction3(data)) {
        callback = data;
        data = encoding = null;
      } else if (isFunction3(encoding)) {
        callback = encoding;
        encoding = null;
      }
      if (!data) {
        this._ended = this._ending = true;
        this._currentRequest.end(null, null, callback);
      } else {
        var self2 = this;
        var currentRequest = this._currentRequest;
        this.write(data, encoding, function() {
          self2._ended = true;
          currentRequest.end(null, null, callback);
        });
        this._ending = true;
      }
    };
    RedirectableRequest.prototype.setHeader = function(name, value) {
      this._options.headers[name] = value;
      this._currentRequest.setHeader(name, value);
    };
    RedirectableRequest.prototype.removeHeader = function(name) {
      delete this._options.headers[name];
      this._currentRequest.removeHeader(name);
    };
    RedirectableRequest.prototype.setTimeout = function(msecs, callback) {
      var self2 = this;
      function destroyOnTimeout(socket) {
        socket.setTimeout(msecs);
        socket.removeListener("timeout", socket.destroy);
        socket.addListener("timeout", socket.destroy);
      }
      function startTimer(socket) {
        if (self2._timeout) {
          clearTimeout(self2._timeout);
        }
        self2._timeout = setTimeout(function() {
          self2.emit("timeout");
          clearTimer();
        }, msecs);
        destroyOnTimeout(socket);
      }
      function clearTimer() {
        if (self2._timeout) {
          clearTimeout(self2._timeout);
          self2._timeout = null;
        }
        self2.removeListener("abort", clearTimer);
        self2.removeListener("error", clearTimer);
        self2.removeListener("response", clearTimer);
        self2.removeListener("close", clearTimer);
        if (callback) {
          self2.removeListener("timeout", callback);
        }
        if (!self2.socket) {
          self2._currentRequest.removeListener("socket", startTimer);
        }
      }
      if (callback) {
        this.on("timeout", callback);
      }
      if (this.socket) {
        startTimer(this.socket);
      } else {
        this._currentRequest.once("socket", startTimer);
      }
      this.on("socket", destroyOnTimeout);
      this.on("abort", clearTimer);
      this.on("error", clearTimer);
      this.on("response", clearTimer);
      this.on("close", clearTimer);
      return this;
    };
    [
      "flushHeaders",
      "getHeader",
      "setNoDelay",
      "setSocketKeepAlive"
    ].forEach(function(method) {
      RedirectableRequest.prototype[method] = function(a, b) {
        return this._currentRequest[method](a, b);
      };
    });
    ["aborted", "connection", "socket"].forEach(function(property) {
      Object.defineProperty(RedirectableRequest.prototype, property, {
        get: function() {
          return this._currentRequest[property];
        }
      });
    });
    RedirectableRequest.prototype._sanitizeOptions = function(options) {
      if (!options.headers) {
        options.headers = {};
      }
      if (!isArray2(options.sensitiveHeaders)) {
        options.sensitiveHeaders = [];
      }
      if (options.host) {
        if (!options.hostname) {
          options.hostname = options.host;
        }
        delete options.host;
      }
      if (!options.pathname && options.path) {
        var searchPos = options.path.indexOf("?");
        if (searchPos < 0) {
          options.pathname = options.path;
        } else {
          options.pathname = options.path.substring(0, searchPos);
          options.search = options.path.substring(searchPos);
        }
      }
    };
    RedirectableRequest.prototype._performRequest = function() {
      var protocol = this._options.protocol;
      var nativeProtocol = this._options.nativeProtocols[protocol];
      if (!nativeProtocol) {
        throw new TypeError("Unsupported protocol " + protocol);
      }
      if (this._options.agents) {
        var scheme = protocol.slice(0, -1);
        this._options.agent = this._options.agents[scheme];
      }
      var request = this._currentRequest = nativeProtocol.request(this._options, this._onNativeResponse);
      request._redirectable = this;
      for (var event of events2) {
        request.on(event, eventHandlers[event]);
      }
      this._currentUrl = /^\//.test(this._options.path) ? url2.format(this._options) : (
        // When making a request to a proxy, […]
        // a client MUST send the target URI in absolute-form […].
        this._options.path
      );
      if (this._isRedirect) {
        var i = 0;
        var self2 = this;
        var buffers = this._requestBodyBuffers;
        (function writeNext(error) {
          if (request === self2._currentRequest) {
            if (error) {
              self2.emit("error", error);
            } else if (i < buffers.length) {
              var buffer = buffers[i++];
              if (!request.finished) {
                request.write(buffer.data, buffer.encoding, writeNext);
              }
            } else if (self2._ended) {
              request.end();
            }
          }
        })();
      }
    };
    RedirectableRequest.prototype._processResponse = function(response) {
      var statusCode = response.statusCode;
      if (this._options.trackRedirects) {
        this._redirects.push({
          url: this._currentUrl,
          headers: response.headers,
          statusCode
        });
      }
      var location = response.headers.location;
      if (!location || this._options.followRedirects === false || statusCode < 300 || statusCode >= 400) {
        response.responseUrl = this._currentUrl;
        response.redirects = this._redirects;
        this.emit("response", response);
        this._requestBodyBuffers = [];
        return;
      }
      destroyRequest(this._currentRequest);
      response.destroy();
      if (++this._redirectCount > this._options.maxRedirects) {
        throw new TooManyRedirectsError();
      }
      var requestHeaders;
      var beforeRedirect = this._options.beforeRedirect;
      if (beforeRedirect) {
        requestHeaders = Object.assign({
          // The Host header was set by nativeProtocol.request
          Host: response.req.getHeader("host")
        }, this._options.headers);
      }
      var method = this._options.method;
      if ((statusCode === 301 || statusCode === 302) && this._options.method === "POST" || // RFC7231§6.4.4: The 303 (See Other) status code indicates that
      // the server is redirecting the user agent to a different resource […]
      // A user agent can perform a retrieval request targeting that URI
      // (a GET or HEAD request if using HTTP) […]
      statusCode === 303 && !/^(?:GET|HEAD)$/.test(this._options.method)) {
        this._options.method = "GET";
        this._requestBodyBuffers = [];
        removeMatchingHeaders(/^content-/i, this._options.headers);
      }
      var currentHostHeader = removeMatchingHeaders(/^host$/i, this._options.headers);
      var currentUrlParts = parseUrl2(this._currentUrl);
      var currentHost = currentHostHeader || currentUrlParts.host;
      var currentUrl = /^\w+:/.test(location) ? this._currentUrl : url2.format(Object.assign(currentUrlParts, { host: currentHost }));
      var redirectUrl = resolveUrl(location, currentUrl);
      debug("redirecting to", redirectUrl.href);
      this._isRedirect = true;
      spreadUrlObject(redirectUrl, this._options);
      if (redirectUrl.protocol !== currentUrlParts.protocol && redirectUrl.protocol !== "https:" || redirectUrl.host !== currentHost && !isSubdomain(redirectUrl.host, currentHost)) {
        removeMatchingHeaders(this._headerFilter, this._options.headers);
      }
      if (isFunction3(beforeRedirect)) {
        var responseDetails = {
          headers: response.headers,
          statusCode
        };
        var requestDetails = {
          url: currentUrl,
          method,
          headers: requestHeaders
        };
        beforeRedirect(this._options, responseDetails, requestDetails);
        this._sanitizeOptions(this._options);
      }
      this._performRequest();
    };
    function wrap(protocols) {
      var exports3 = {
        maxRedirects: 21,
        maxBodyLength: 10 * 1024 * 1024
      };
      var nativeProtocols = {};
      Object.keys(protocols).forEach(function(scheme) {
        var protocol = scheme + ":";
        var nativeProtocol = nativeProtocols[protocol] = protocols[scheme];
        var wrappedProtocol = exports3[scheme] = Object.create(nativeProtocol);
        function request(input, options, callback) {
          if (isURL(input)) {
            input = spreadUrlObject(input);
          } else if (isString2(input)) {
            input = spreadUrlObject(parseUrl2(input));
          } else {
            callback = options;
            options = validateUrl(input);
            input = { protocol };
          }
          if (isFunction3(options)) {
            callback = options;
            options = null;
          }
          options = Object.assign({
            maxRedirects: exports3.maxRedirects,
            maxBodyLength: exports3.maxBodyLength
          }, input, options);
          options.nativeProtocols = nativeProtocols;
          if (!isString2(options.host) && !isString2(options.hostname)) {
            options.hostname = "::1";
          }
          assert.equal(options.protocol, protocol, "protocol mismatch");
          debug("options", options);
          return new RedirectableRequest(options, callback);
        }
        function get(input, options, callback) {
          var wrappedRequest = wrappedProtocol.request(input, options, callback);
          wrappedRequest.end();
          return wrappedRequest;
        }
        Object.defineProperties(wrappedProtocol, {
          request: { value: request, configurable: true, enumerable: true, writable: true },
          get: { value: get, configurable: true, enumerable: true, writable: true }
        });
      });
      return exports3;
    }
    function noop2() {
    }
    function parseUrl2(input) {
      var parsed;
      if (useNativeURL) {
        parsed = new URL2(input);
      } else {
        parsed = validateUrl(url2.parse(input));
        if (!isString2(parsed.protocol)) {
          throw new InvalidUrlError({ input });
        }
      }
      return parsed;
    }
    function resolveUrl(relative, base) {
      return useNativeURL ? new URL2(relative, base) : parseUrl2(url2.resolve(base, relative));
    }
    function validateUrl(input) {
      if (/^\[/.test(input.hostname) && !/^\[[:0-9a-f]+\]$/i.test(input.hostname)) {
        throw new InvalidUrlError({ input: input.href || input });
      }
      if (/^\[/.test(input.host) && !/^\[[:0-9a-f]+\](:\d+)?$/i.test(input.host)) {
        throw new InvalidUrlError({ input: input.href || input });
      }
      return input;
    }
    function spreadUrlObject(urlObject, target) {
      var spread3 = target || {};
      for (var key of preservedUrlFields) {
        spread3[key] = urlObject[key];
      }
      if (spread3.hostname.startsWith("[")) {
        spread3.hostname = spread3.hostname.slice(1, -1);
      }
      if (spread3.port !== "") {
        spread3.port = Number(spread3.port);
      }
      spread3.path = spread3.search ? spread3.pathname + spread3.search : spread3.pathname;
      return spread3;
    }
    function removeMatchingHeaders(regex, headers) {
      var lastValue;
      for (var header in headers) {
        if (regex.test(header)) {
          lastValue = headers[header];
          delete headers[header];
        }
      }
      return lastValue === null || typeof lastValue === "undefined" ? void 0 : String(lastValue).trim();
    }
    function createErrorType(code, message, baseClass) {
      function CustomError(properties) {
        if (isFunction3(Error.captureStackTrace)) {
          Error.captureStackTrace(this, this.constructor);
        }
        Object.assign(this, properties || {});
        this.code = code;
        this.message = this.cause ? message + ": " + this.cause.message : message;
      }
      CustomError.prototype = new (baseClass || Error)();
      Object.defineProperties(CustomError.prototype, {
        constructor: {
          value: CustomError,
          enumerable: false
        },
        name: {
          value: "Error [" + code + "]",
          enumerable: false
        }
      });
      return CustomError;
    }
    function destroyRequest(request, error) {
      for (var event of events2) {
        request.removeListener(event, eventHandlers[event]);
      }
      request.on("error", noop2);
      request.destroy(error);
    }
    function isSubdomain(subdomain, domain) {
      assert(isString2(subdomain) && isString2(domain));
      var dot = subdomain.length - domain.length - 1;
      return dot > 0 && subdomain[dot] === "." && subdomain.endsWith(domain);
    }
    function isArray2(value) {
      return value instanceof Array;
    }
    function isString2(value) {
      return typeof value === "string" || value instanceof String;
    }
    function isFunction3(value) {
      return typeof value === "function";
    }
    function isBuffer2(value) {
      return typeof value === "object" && "length" in value;
    }
    function isURL(value) {
      return URL2 && value instanceof URL2;
    }
    function escapeRegex(regex) {
      return regex.replace(/[\]\\/()*+?.$]/g, "\\$&");
    }
    module2.exports = wrap({ http: http7, https: https2 });
    module2.exports.wrap = wrap;
  }
});

// <stdin>
var stdin_exports = {};
__export(stdin_exports, {
  DEMO_DATASET: () => DEMO_DATASET,
  DEMO_TODAY_ISO: () => DEMO_TODAY_ISO,
  gradesHandlers: () => gradesHandlers,
  offeringsHandlers: () => offeringsHandlers,
  offeringsOwnedByTeacher: () => offeringsOwnedByTeacher,
  studentsHandlers: () => studentsHandlers,
  teachersHandlers: () => teachersHandlers
});
module.exports = __toCommonJS(stdin_exports);

// src/shared/api/mocks/handlers/students.ts
var import_msw2 = require("msw");

// node_modules/axios/lib/helpers/bind.js
function bind(fn, thisArg) {
  return function wrap() {
    return fn.apply(thisArg, arguments);
  };
}

// node_modules/axios/lib/utils.js
var { toString } = Object.prototype;
var { getPrototypeOf } = Object;
var { iterator, toStringTag } = Symbol;
var hasOwnProperty = (({ hasOwnProperty: hasOwnProperty2 }) => (obj, prop) => hasOwnProperty2.call(obj, prop))(Object.prototype);
var hasOwnInPrototypeChain = (thing, prop) => {
  let obj = thing;
  const seen = [];
  while (obj != null && obj !== Object.prototype) {
    if (seen.indexOf(obj) !== -1) {
      return false;
    }
    seen.push(obj);
    if (hasOwnProperty(obj, prop)) {
      return true;
    }
    obj = getPrototypeOf(obj);
  }
  return false;
};
var getSafeProp = (obj, prop) => obj != null && hasOwnInPrototypeChain(obj, prop) ? obj[prop] : void 0;
var kindOf = /* @__PURE__ */ ((cache) => (thing) => {
  const str = toString.call(thing);
  return cache[str] || (cache[str] = str.slice(8, -1).toLowerCase());
})(/* @__PURE__ */ Object.create(null));
var kindOfTest = (type) => {
  type = type.toLowerCase();
  return (thing) => kindOf(thing) === type;
};
var typeOfTest = (type) => (thing) => typeof thing === type;
var { isArray } = Array;
var isUndefined = typeOfTest("undefined");
function isBuffer(val) {
  return val !== null && !isUndefined(val) && val.constructor !== null && !isUndefined(val.constructor) && isFunction(val.constructor.isBuffer) && val.constructor.isBuffer(val);
}
var isArrayBuffer = kindOfTest("ArrayBuffer");
function isArrayBufferView(val) {
  let result;
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView) {
    result = ArrayBuffer.isView(val);
  } else {
    result = val && val.buffer && isArrayBuffer(val.buffer);
  }
  return result;
}
var isString = typeOfTest("string");
var isFunction = typeOfTest("function");
var isNumber = typeOfTest("number");
var isObject = (thing) => thing !== null && typeof thing === "object";
var isBoolean = (thing) => thing === true || thing === false;
var isPlainObject = (val) => {
  if (!isObject(val)) {
    return false;
  }
  const prototype2 = getPrototypeOf(val);
  return (prototype2 === null || prototype2 === Object.prototype || getPrototypeOf(prototype2) === null) && // Treat any genuine (non-Object.prototype-polluted) Symbol.toStringTag or
  // Symbol.iterator as evidence the value is a tagged/iterable type rather
  // than a plain object, while ignoring keys injected onto Object.prototype.
  !hasOwnInPrototypeChain(val, toStringTag) && !hasOwnInPrototypeChain(val, iterator);
};
var isEmptyObject = (val) => {
  if (!isObject(val) || isBuffer(val)) {
    return false;
  }
  try {
    return Object.keys(val).length === 0 && Object.getPrototypeOf(val) === Object.prototype;
  } catch (e) {
    return false;
  }
};
var isDate = kindOfTest("Date");
var isFile = kindOfTest("File");
var isReactNativeBlob = (value) => {
  return !!(value && typeof value.uri !== "undefined");
};
var isReactNative = (formData) => formData && typeof formData.getParts !== "undefined";
var isBlob = kindOfTest("Blob");
var isFileList = kindOfTest("FileList");
var isStream = (val) => isObject(val) && isFunction(val.pipe);
function getGlobal() {
  if (typeof globalThis !== "undefined") return globalThis;
  if (typeof self !== "undefined") return self;
  if (typeof window !== "undefined") return window;
  if (typeof global !== "undefined") return global;
  return {};
}
var G = getGlobal();
var FormDataCtor = typeof G.FormData !== "undefined" ? G.FormData : void 0;
var isFormData = (thing) => {
  if (!thing) return false;
  if (FormDataCtor && thing instanceof FormDataCtor) return true;
  const proto = getPrototypeOf(thing);
  if (!proto || proto === Object.prototype) return false;
  if (!isFunction(thing.append)) return false;
  const kind = kindOf(thing);
  return kind === "formdata" || // detect form-data instance
  kind === "object" && isFunction(thing.toString) && thing.toString() === "[object FormData]";
};
var isURLSearchParams = kindOfTest("URLSearchParams");
var [isReadableStream, isRequest, isResponse, isHeaders] = [
  "ReadableStream",
  "Request",
  "Response",
  "Headers"
].map(kindOfTest);
var trim = (str) => {
  return str.trim ? str.trim() : str.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, "");
};
function forEach(obj, fn, { allOwnKeys = false } = {}) {
  if (obj === null || typeof obj === "undefined") {
    return;
  }
  let i;
  let l;
  if (typeof obj !== "object") {
    obj = [obj];
  }
  if (isArray(obj)) {
    for (i = 0, l = obj.length; i < l; i++) {
      fn.call(null, obj[i], i, obj);
    }
  } else {
    if (isBuffer(obj)) {
      return;
    }
    const keys = allOwnKeys ? Object.getOwnPropertyNames(obj) : Object.keys(obj);
    const len = keys.length;
    let key;
    for (i = 0; i < len; i++) {
      key = keys[i];
      fn.call(null, obj[key], key, obj);
    }
  }
}
function findKey(obj, key) {
  if (isBuffer(obj)) {
    return null;
  }
  key = key.toLowerCase();
  const keys = Object.keys(obj);
  let i = keys.length;
  let _key;
  while (i-- > 0) {
    _key = keys[i];
    if (key === _key.toLowerCase()) {
      return _key;
    }
  }
  return null;
}
var _global = (() => {
  if (typeof globalThis !== "undefined") return globalThis;
  return typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : global;
})();
var isContextDefined = (context) => !isUndefined(context) && context !== _global;
function merge(...objs) {
  const { caseless, skipUndefined } = isContextDefined(this) && this || {};
  const result = {};
  const assignValue = (val, key) => {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      return;
    }
    const targetKey = caseless && typeof key === "string" && findKey(result, key) || key;
    const existing = hasOwnProperty(result, targetKey) ? result[targetKey] : void 0;
    if (isPlainObject(existing) && isPlainObject(val)) {
      result[targetKey] = merge(existing, val);
    } else if (isPlainObject(val)) {
      result[targetKey] = merge({}, val);
    } else if (isArray(val)) {
      result[targetKey] = val.slice();
    } else if (!skipUndefined || !isUndefined(val)) {
      result[targetKey] = val;
    }
  };
  for (let i = 0, l = objs.length; i < l; i++) {
    const source = objs[i];
    if (!source || isBuffer(source)) {
      continue;
    }
    forEach(source, assignValue);
    if (typeof source !== "object" || isArray(source)) {
      continue;
    }
    const symbols = Object.getOwnPropertySymbols(source);
    for (let j = 0; j < symbols.length; j++) {
      const symbol = symbols[j];
      if (propertyIsEnumerable.call(source, symbol)) {
        assignValue(source[symbol], symbol);
      }
    }
  }
  return result;
}
var extend = (a, b, thisArg, { allOwnKeys } = {}) => {
  forEach(
    b,
    (val, key) => {
      if (thisArg && isFunction(val)) {
        Object.defineProperty(a, key, {
          // Null-proto descriptor so a polluted Object.prototype.get cannot
          // hijack defineProperty's accessor-vs-data resolution.
          __proto__: null,
          value: bind(val, thisArg),
          writable: true,
          enumerable: true,
          configurable: true
        });
      } else {
        Object.defineProperty(a, key, {
          __proto__: null,
          value: val,
          writable: true,
          enumerable: true,
          configurable: true
        });
      }
    },
    { allOwnKeys }
  );
  return a;
};
var stripBOM = (content) => {
  if (content.charCodeAt(0) === 65279) {
    content = content.slice(1);
  }
  return content;
};
var inherits = (constructor, superConstructor, props, descriptors) => {
  constructor.prototype = Object.create(superConstructor.prototype, descriptors);
  Object.defineProperty(constructor.prototype, "constructor", {
    __proto__: null,
    value: constructor,
    writable: true,
    enumerable: false,
    configurable: true
  });
  Object.defineProperty(constructor, "super", {
    __proto__: null,
    value: superConstructor.prototype
  });
  props && Object.assign(constructor.prototype, props);
};
var toFlatObject = (sourceObj, destObj, filter2, propFilter) => {
  let props;
  let i;
  let prop;
  const merged = {};
  destObj = destObj || {};
  if (sourceObj == null) return destObj;
  do {
    props = Object.getOwnPropertyNames(sourceObj);
    i = props.length;
    while (i-- > 0) {
      prop = props[i];
      if ((!propFilter || propFilter(prop, sourceObj, destObj)) && !merged[prop]) {
        destObj[prop] = sourceObj[prop];
        merged[prop] = true;
      }
    }
    sourceObj = filter2 !== false && getPrototypeOf(sourceObj);
  } while (sourceObj && (!filter2 || filter2(sourceObj, destObj)) && sourceObj !== Object.prototype);
  return destObj;
};
var endsWith = (str, searchString, position) => {
  str = String(str);
  if (position === void 0 || position > str.length) {
    position = str.length;
  }
  position -= searchString.length;
  const lastIndex = str.indexOf(searchString, position);
  return lastIndex !== -1 && lastIndex === position;
};
var toArray = (thing) => {
  if (!thing) return null;
  if (isArray(thing)) return thing;
  let i = thing.length;
  if (!isNumber(i)) return null;
  const arr = new Array(i);
  while (i-- > 0) {
    arr[i] = thing[i];
  }
  return arr;
};
var isTypedArray = /* @__PURE__ */ ((TypedArray) => {
  return (thing) => {
    return TypedArray && thing instanceof TypedArray;
  };
})(typeof Uint8Array !== "undefined" && getPrototypeOf(Uint8Array));
var forEachEntry = (obj, fn) => {
  const generator = obj && obj[iterator];
  const _iterator = generator.call(obj);
  let result;
  while ((result = _iterator.next()) && !result.done) {
    const pair = result.value;
    fn.call(obj, pair[0], pair[1]);
  }
};
var matchAll = (regExp, str) => {
  let matches;
  const arr = [];
  while ((matches = regExp.exec(str)) !== null) {
    arr.push(matches);
  }
  return arr;
};
var isHTMLForm = kindOfTest("HTMLFormElement");
var toCamelCase = (str) => {
  return str.toLowerCase().replace(/[-_\s]([a-z\d])(\w*)/g, function replacer(m, p1, p2) {
    return p1.toUpperCase() + p2;
  });
};
var { propertyIsEnumerable } = Object.prototype;
var isRegExp = kindOfTest("RegExp");
var reduceDescriptors = (obj, reducer) => {
  const descriptors = Object.getOwnPropertyDescriptors(obj);
  const reducedDescriptors = {};
  forEach(descriptors, (descriptor, name) => {
    let ret;
    if ((ret = reducer(descriptor, name, obj)) !== false) {
      reducedDescriptors[name] = ret || descriptor;
    }
  });
  Object.defineProperties(obj, reducedDescriptors);
};
var freezeMethods = (obj) => {
  reduceDescriptors(obj, (descriptor, name) => {
    if (isFunction(obj) && ["arguments", "caller", "callee"].includes(name)) {
      return false;
    }
    const value = obj[name];
    if (!isFunction(value)) return;
    descriptor.enumerable = false;
    if ("writable" in descriptor) {
      descriptor.writable = false;
      return;
    }
    if (!descriptor.set) {
      descriptor.set = () => {
        throw Error("Can not rewrite read-only method '" + name + "'");
      };
    }
  });
};
var toObjectSet = (arrayOrString, delimiter) => {
  const obj = {};
  const define = (arr) => {
    arr.forEach((value) => {
      obj[value] = true;
    });
  };
  isArray(arrayOrString) ? define(arrayOrString) : define(String(arrayOrString).split(delimiter));
  return obj;
};
var noop = () => {
};
var toFiniteNumber = (value, defaultValue) => {
  return value != null && Number.isFinite(value = +value) ? value : defaultValue;
};
function isSpecCompliantForm(thing) {
  return !!(thing && isFunction(thing.append) && thing[toStringTag] === "FormData" && thing[iterator]);
}
var toJSONObject = (obj) => {
  const visited = /* @__PURE__ */ new WeakSet();
  const visit = (source) => {
    if (isObject(source)) {
      if (visited.has(source)) {
        return;
      }
      if (isBuffer(source)) {
        return source;
      }
      if (!("toJSON" in source)) {
        visited.add(source);
        const target = isArray(source) ? [] : {};
        forEach(source, (value, key) => {
          const reducedValue = visit(value);
          !isUndefined(reducedValue) && (target[key] = reducedValue);
        });
        visited.delete(source);
        return target;
      }
    }
    return source;
  };
  return visit(obj);
};
var isAsyncFn = kindOfTest("AsyncFunction");
var isThenable = (thing) => thing && (isObject(thing) || isFunction(thing)) && isFunction(thing.then) && isFunction(thing.catch);
var _setImmediate = ((setImmediateSupported, postMessageSupported) => {
  if (setImmediateSupported) {
    return setImmediate;
  }
  return postMessageSupported ? ((token, callbacks) => {
    _global.addEventListener(
      "message",
      ({ source, data }) => {
        if (source === _global && data === token) {
          callbacks.length && callbacks.shift()();
        }
      },
      false
    );
    return (cb) => {
      callbacks.push(cb);
      _global.postMessage(token, "*");
    };
  })(`axios@${Math.random()}`, []) : (cb) => setTimeout(cb);
})(typeof setImmediate === "function", isFunction(_global.postMessage));
var asap = typeof queueMicrotask !== "undefined" ? queueMicrotask.bind(_global) : typeof process !== "undefined" && process.nextTick || _setImmediate;
var isIterable = (thing) => thing != null && isFunction(thing[iterator]);
var isSafeIterable = (thing) => thing != null && hasOwnInPrototypeChain(thing, iterator) && isIterable(thing);
var utils_default = {
  isArray,
  isArrayBuffer,
  isBuffer,
  isFormData,
  isArrayBufferView,
  isString,
  isNumber,
  isBoolean,
  isObject,
  isPlainObject,
  isEmptyObject,
  isReadableStream,
  isRequest,
  isResponse,
  isHeaders,
  isUndefined,
  isDate,
  isFile,
  isReactNativeBlob,
  isReactNative,
  isBlob,
  isRegExp,
  isFunction,
  isStream,
  isURLSearchParams,
  isTypedArray,
  isFileList,
  forEach,
  merge,
  extend,
  trim,
  stripBOM,
  inherits,
  toFlatObject,
  kindOf,
  kindOfTest,
  endsWith,
  toArray,
  forEachEntry,
  matchAll,
  isHTMLForm,
  hasOwnProperty,
  hasOwnProp: hasOwnProperty,
  // an alias to avoid ESLint no-prototype-builtins detection
  hasOwnInPrototypeChain,
  getSafeProp,
  reduceDescriptors,
  freezeMethods,
  toObjectSet,
  toCamelCase,
  noop,
  toFiniteNumber,
  findKey,
  global: _global,
  isContextDefined,
  isSpecCompliantForm,
  toJSONObject,
  isAsyncFn,
  isThenable,
  setImmediate: _setImmediate,
  asap,
  isIterable,
  isSafeIterable
};

// node_modules/axios/lib/helpers/parseHeaders.js
var ignoreDuplicateOf = utils_default.toObjectSet([
  "age",
  "authorization",
  "content-length",
  "content-type",
  "etag",
  "expires",
  "from",
  "host",
  "if-modified-since",
  "if-unmodified-since",
  "last-modified",
  "location",
  "max-forwards",
  "proxy-authorization",
  "referer",
  "retry-after",
  "user-agent"
]);
var parseHeaders_default = (rawHeaders) => {
  const parsed = {};
  let key;
  let val;
  let i;
  rawHeaders && rawHeaders.split("\n").forEach(function parser(line) {
    i = line.indexOf(":");
    key = line.substring(0, i).trim().toLowerCase();
    val = line.substring(i + 1).trim();
    if (!key || parsed[key] && ignoreDuplicateOf[key]) {
      return;
    }
    if (key === "set-cookie") {
      if (parsed[key]) {
        parsed[key].push(val);
      } else {
        parsed[key] = [val];
      }
    } else {
      parsed[key] = parsed[key] ? parsed[key] + ", " + val : val;
    }
  });
  return parsed;
};

// node_modules/axios/lib/helpers/sanitizeHeaderValue.js
function trimSPorHTAB(str) {
  let start = 0;
  let end = str.length;
  while (start < end) {
    const code = str.charCodeAt(start);
    if (code !== 9 && code !== 32) {
      break;
    }
    start += 1;
  }
  while (end > start) {
    const code = str.charCodeAt(end - 1);
    if (code !== 9 && code !== 32) {
      break;
    }
    end -= 1;
  }
  return start === 0 && end === str.length ? str : str.slice(start, end);
}
var INVALID_UNICODE_HEADER_VALUE_CHARS = new RegExp("[\\u0000-\\u0008\\u000a-\\u001f\\u007f]+", "g");
var INVALID_BYTE_STRING_HEADER_VALUE_CHARS = new RegExp("[^\\u0009\\u0020-\\u007e\\u0080-\\u00ff]+", "g");
function sanitizeValue(value, invalidChars) {
  if (utils_default.isArray(value)) {
    return value.map((item) => sanitizeValue(item, invalidChars));
  }
  return trimSPorHTAB(String(value).replace(invalidChars, ""));
}
var sanitizeHeaderValue = (value) => sanitizeValue(value, INVALID_UNICODE_HEADER_VALUE_CHARS);
var sanitizeByteStringHeaderValue = (value) => sanitizeValue(value, INVALID_BYTE_STRING_HEADER_VALUE_CHARS);
function toByteStringHeaderObject(headers) {
  const byteStringHeaders = /* @__PURE__ */ Object.create(null);
  utils_default.forEach(headers.toJSON(), (value, header) => {
    byteStringHeaders[header] = sanitizeByteStringHeaderValue(value);
  });
  return byteStringHeaders;
}

// node_modules/axios/lib/core/AxiosHeaders.js
var $internals = Symbol("internals");
function normalizeHeader(header) {
  return header && String(header).trim().toLowerCase();
}
function normalizeValue(value) {
  if (value === false || value == null) {
    return value;
  }
  return utils_default.isArray(value) ? value.map(normalizeValue) : sanitizeHeaderValue(String(value));
}
function parseTokens(str) {
  const tokens = /* @__PURE__ */ Object.create(null);
  const tokensRE = /([^\s,;=]+)\s*(?:=\s*([^,;]+))?/g;
  let match;
  while (match = tokensRE.exec(str)) {
    tokens[match[1]] = match[2];
  }
  return tokens;
}
var isValidHeaderName = (str) => /^[-_a-zA-Z0-9^`|~,!#$%&'*+.]+$/.test(str.trim());
function matchHeaderValue(context, value, header, filter2, isHeaderNameFilter) {
  if (utils_default.isFunction(filter2)) {
    return filter2.call(this, value, header);
  }
  if (isHeaderNameFilter) {
    value = header;
  }
  if (!utils_default.isString(value)) return;
  if (utils_default.isString(filter2)) {
    return value.indexOf(filter2) !== -1;
  }
  if (utils_default.isRegExp(filter2)) {
    return filter2.test(value);
  }
}
function formatHeader(header) {
  return header.trim().toLowerCase().replace(/([a-z\d])(\w*)/g, (w, char, str) => {
    return char.toUpperCase() + str;
  });
}
function buildAccessors(obj, header) {
  const accessorName = utils_default.toCamelCase(" " + header);
  ["get", "set", "has"].forEach((methodName) => {
    Object.defineProperty(obj, methodName + accessorName, {
      // Null-proto descriptor so a polluted Object.prototype.get cannot turn
      // this data descriptor into an accessor descriptor on the way in.
      __proto__: null,
      value: function(arg1, arg2, arg3) {
        return this[methodName].call(this, header, arg1, arg2, arg3);
      },
      configurable: true
    });
  });
}
var AxiosHeaders = class {
  constructor(headers) {
    headers && this.set(headers);
  }
  set(header, valueOrRewrite, rewrite) {
    const self2 = this;
    function setHeader(_value, _header, _rewrite) {
      const lHeader = normalizeHeader(_header);
      if (!lHeader) {
        return;
      }
      const key = utils_default.findKey(self2, lHeader);
      if (!key || self2[key] === void 0 || _rewrite === true || _rewrite === void 0 && self2[key] !== false) {
        self2[key || _header] = normalizeValue(_value);
      }
    }
    const setHeaders = (headers, _rewrite) => utils_default.forEach(headers, (_value, _header) => setHeader(_value, _header, _rewrite));
    if (utils_default.isPlainObject(header) || header instanceof this.constructor) {
      setHeaders(header, valueOrRewrite);
    } else if (utils_default.isString(header) && (header = header.trim()) && !isValidHeaderName(header)) {
      setHeaders(parseHeaders_default(header), valueOrRewrite);
    } else if (utils_default.isObject(header) && utils_default.isSafeIterable(header)) {
      let obj = /* @__PURE__ */ Object.create(null), dest, key;
      for (const entry of header) {
        if (!utils_default.isArray(entry)) {
          throw new TypeError("Object iterator must return a key-value pair");
        }
        key = entry[0];
        if (utils_default.hasOwnProp(obj, key)) {
          dest = obj[key];
          obj[key] = utils_default.isArray(dest) ? [...dest, entry[1]] : [dest, entry[1]];
        } else {
          obj[key] = entry[1];
        }
      }
      setHeaders(obj, valueOrRewrite);
    } else {
      header != null && setHeader(valueOrRewrite, header, rewrite);
    }
    return this;
  }
  get(header, parser) {
    header = normalizeHeader(header);
    if (header) {
      const key = utils_default.findKey(this, header);
      if (key) {
        const value = this[key];
        if (!parser) {
          return value;
        }
        if (parser === true) {
          return parseTokens(value);
        }
        if (utils_default.isFunction(parser)) {
          return parser.call(this, value, key);
        }
        if (utils_default.isRegExp(parser)) {
          return parser.exec(value);
        }
        throw new TypeError("parser must be boolean|regexp|function");
      }
    }
  }
  has(header, matcher) {
    header = normalizeHeader(header);
    if (header) {
      const key = utils_default.findKey(this, header);
      return !!(key && this[key] !== void 0 && (!matcher || matchHeaderValue(this, this[key], key, matcher)));
    }
    return false;
  }
  delete(header, matcher) {
    const self2 = this;
    let deleted = false;
    function deleteHeader(_header) {
      _header = normalizeHeader(_header);
      if (_header) {
        const key = utils_default.findKey(self2, _header);
        if (key && (!matcher || matchHeaderValue(self2, self2[key], key, matcher))) {
          delete self2[key];
          deleted = true;
        }
      }
    }
    if (utils_default.isArray(header)) {
      header.forEach(deleteHeader);
    } else {
      deleteHeader(header);
    }
    return deleted;
  }
  clear(matcher) {
    const keys = Object.keys(this);
    let i = keys.length;
    let deleted = false;
    while (i--) {
      const key = keys[i];
      if (!matcher || matchHeaderValue(this, this[key], key, matcher, true)) {
        delete this[key];
        deleted = true;
      }
    }
    return deleted;
  }
  normalize(format) {
    const self2 = this;
    const headers = {};
    utils_default.forEach(this, (value, header) => {
      const key = utils_default.findKey(headers, header);
      if (key) {
        self2[key] = normalizeValue(value);
        delete self2[header];
        return;
      }
      const normalized = format ? formatHeader(header) : String(header).trim();
      if (normalized !== header) {
        delete self2[header];
      }
      self2[normalized] = normalizeValue(value);
      headers[normalized] = true;
    });
    return this;
  }
  concat(...targets) {
    return this.constructor.concat(this, ...targets);
  }
  toJSON(asStrings) {
    const obj = /* @__PURE__ */ Object.create(null);
    utils_default.forEach(this, (value, header) => {
      value != null && value !== false && (obj[header] = asStrings && utils_default.isArray(value) ? value.join(", ") : value);
    });
    return obj;
  }
  [Symbol.iterator]() {
    return Object.entries(this.toJSON())[Symbol.iterator]();
  }
  toString() {
    return Object.entries(this.toJSON()).map(([header, value]) => header + ": " + value).join("\n");
  }
  getSetCookie() {
    return this.get("set-cookie") || [];
  }
  get [Symbol.toStringTag]() {
    return "AxiosHeaders";
  }
  static from(thing) {
    return thing instanceof this ? thing : new this(thing);
  }
  static concat(first, ...targets) {
    const computed = new this(first);
    targets.forEach((target) => computed.set(target));
    return computed;
  }
  static accessor(header) {
    const internals = this[$internals] = this[$internals] = {
      accessors: {}
    };
    const accessors = internals.accessors;
    const prototype2 = this.prototype;
    function defineAccessor(_header) {
      const lHeader = normalizeHeader(_header);
      if (!accessors[lHeader]) {
        buildAccessors(prototype2, _header);
        accessors[lHeader] = true;
      }
    }
    utils_default.isArray(header) ? header.forEach(defineAccessor) : defineAccessor(header);
    return this;
  }
};
AxiosHeaders.accessor([
  "Content-Type",
  "Content-Length",
  "Accept",
  "Accept-Encoding",
  "User-Agent",
  "Authorization"
]);
utils_default.reduceDescriptors(AxiosHeaders.prototype, ({ value }, key) => {
  let mapped = key[0].toUpperCase() + key.slice(1);
  return {
    get: () => value,
    set(headerValue) {
      this[mapped] = headerValue;
    }
  };
});
utils_default.freezeMethods(AxiosHeaders);
var AxiosHeaders_default = AxiosHeaders;

// node_modules/axios/lib/core/AxiosError.js
var REDACTED = "[REDACTED ****]";
function hasOwnOrPrototypeToJSON(source) {
  if (utils_default.hasOwnProp(source, "toJSON")) {
    return true;
  }
  let prototype2 = Object.getPrototypeOf(source);
  while (prototype2 && prototype2 !== Object.prototype) {
    if (utils_default.hasOwnProp(prototype2, "toJSON")) {
      return true;
    }
    prototype2 = Object.getPrototypeOf(prototype2);
  }
  return false;
}
function redactConfig(config, redactKeys) {
  const lowerKeys = new Set(redactKeys.map((k) => String(k).toLowerCase()));
  const seen = [];
  const visit = (source) => {
    if (source === null || typeof source !== "object") return source;
    if (utils_default.isBuffer(source)) return source;
    if (seen.indexOf(source) !== -1) return void 0;
    if (source instanceof AxiosHeaders_default) {
      source = source.toJSON();
    }
    seen.push(source);
    let result;
    if (utils_default.isArray(source)) {
      result = [];
      source.forEach((v, i) => {
        const reducedValue = visit(v);
        if (!utils_default.isUndefined(reducedValue)) {
          result[i] = reducedValue;
        }
      });
    } else {
      if (!utils_default.isPlainObject(source) && hasOwnOrPrototypeToJSON(source)) {
        seen.pop();
        return source;
      }
      result = /* @__PURE__ */ Object.create(null);
      for (const [key, value] of Object.entries(source)) {
        const reducedValue = lowerKeys.has(key.toLowerCase()) ? REDACTED : visit(value);
        if (!utils_default.isUndefined(reducedValue)) {
          result[key] = reducedValue;
        }
      }
    }
    seen.pop();
    return result;
  };
  return visit(config);
}
var AxiosError = class _AxiosError extends Error {
  static from(error, code, config, request, response, customProps) {
    const axiosError = new _AxiosError(error.message, code || error.code, config, request, response);
    Object.defineProperty(axiosError, "cause", {
      __proto__: null,
      value: error,
      writable: true,
      enumerable: false,
      configurable: true
    });
    axiosError.name = error.name;
    if (error.status != null && axiosError.status == null) {
      axiosError.status = error.status;
    }
    customProps && Object.assign(axiosError, customProps);
    return axiosError;
  }
  /**
   * Create an Error with the specified message, config, error code, request and response.
   *
   * @param {string} message The error message.
   * @param {string} [code] The error code (for example, 'ECONNABORTED').
   * @param {Object} [config] The config.
   * @param {Object} [request] The request.
   * @param {Object} [response] The response.
   *
   * @returns {Error} The created error.
   */
  constructor(message, code, config, request, response) {
    super(message);
    Object.defineProperty(this, "message", {
      // Null-proto descriptor so a polluted Object.prototype.get cannot turn
      // this data descriptor into an accessor descriptor on the way in.
      __proto__: null,
      value: message,
      enumerable: true,
      writable: true,
      configurable: true
    });
    this.name = "AxiosError";
    this.isAxiosError = true;
    code && (this.code = code);
    config && (this.config = config);
    request && (this.request = request);
    if (response) {
      this.response = response;
      this.status = response.status;
    }
  }
  toJSON() {
    const config = this.config;
    const redactKeys = config && utils_default.hasOwnProp(config, "redact") ? config.redact : void 0;
    const serializedConfig = utils_default.isArray(redactKeys) && redactKeys.length > 0 ? redactConfig(config, redactKeys) : utils_default.toJSONObject(config);
    return {
      // Standard
      message: this.message,
      name: this.name,
      // Microsoft
      description: this.description,
      number: this.number,
      // Mozilla
      fileName: this.fileName,
      lineNumber: this.lineNumber,
      columnNumber: this.columnNumber,
      stack: this.stack,
      // Axios
      config: serializedConfig,
      code: this.code,
      status: this.status
    };
  }
};
AxiosError.ERR_BAD_OPTION_VALUE = "ERR_BAD_OPTION_VALUE";
AxiosError.ERR_BAD_OPTION = "ERR_BAD_OPTION";
AxiosError.ECONNABORTED = "ECONNABORTED";
AxiosError.ETIMEDOUT = "ETIMEDOUT";
AxiosError.ECONNREFUSED = "ECONNREFUSED";
AxiosError.ERR_NETWORK = "ERR_NETWORK";
AxiosError.ERR_FR_TOO_MANY_REDIRECTS = "ERR_FR_TOO_MANY_REDIRECTS";
AxiosError.ERR_DEPRECATED = "ERR_DEPRECATED";
AxiosError.ERR_BAD_RESPONSE = "ERR_BAD_RESPONSE";
AxiosError.ERR_BAD_REQUEST = "ERR_BAD_REQUEST";
AxiosError.ERR_CANCELED = "ERR_CANCELED";
AxiosError.ERR_NOT_SUPPORT = "ERR_NOT_SUPPORT";
AxiosError.ERR_INVALID_URL = "ERR_INVALID_URL";
AxiosError.ERR_FORM_DATA_DEPTH_EXCEEDED = "ERR_FORM_DATA_DEPTH_EXCEEDED";
var AxiosError_default = AxiosError;

// node_modules/axios/lib/platform/node/classes/FormData.js
var import_form_data = __toESM(require_form_data(), 1);
var FormData_default = import_form_data.default;

// node_modules/axios/lib/helpers/toFormData.js
var DEFAULT_FORM_DATA_MAX_DEPTH = 100;
function isVisitable(thing) {
  return utils_default.isPlainObject(thing) || utils_default.isArray(thing);
}
function removeBrackets(key) {
  return utils_default.endsWith(key, "[]") ? key.slice(0, -2) : key;
}
function renderKey(path, key, dots) {
  if (!path) return key;
  return path.concat(key).map(function each(token, i) {
    token = removeBrackets(token);
    return !dots && i ? "[" + token + "]" : token;
  }).join(dots ? "." : "");
}
function isFlatArray(arr) {
  return utils_default.isArray(arr) && !arr.some(isVisitable);
}
var predicates = utils_default.toFlatObject(utils_default, {}, null, function filter(prop) {
  return /^is[A-Z]/.test(prop);
});
function toFormData(obj, formData, options) {
  if (!utils_default.isObject(obj)) {
    throw new TypeError("target must be an object");
  }
  formData = formData || new (FormData_default || FormData)();
  options = utils_default.toFlatObject(
    options,
    {
      metaTokens: true,
      dots: false,
      indexes: false
    },
    false,
    function defined(option, source) {
      return !utils_default.isUndefined(source[option]);
    }
  );
  const metaTokens = options.metaTokens;
  const visitor = options.visitor || defaultVisitor;
  const dots = options.dots;
  const indexes = options.indexes;
  const _Blob = options.Blob || typeof Blob !== "undefined" && Blob;
  const maxDepth = options.maxDepth === void 0 ? DEFAULT_FORM_DATA_MAX_DEPTH : options.maxDepth;
  const useBlob = _Blob && utils_default.isSpecCompliantForm(formData);
  const stack = [];
  if (!utils_default.isFunction(visitor)) {
    throw new TypeError("visitor must be a function");
  }
  function convertValue(value) {
    if (value === null) return "";
    if (utils_default.isDate(value)) {
      return value.toISOString();
    }
    if (utils_default.isBoolean(value)) {
      return value.toString();
    }
    if (!useBlob && utils_default.isBlob(value)) {
      throw new AxiosError_default("Blob is not supported. Use a Buffer instead.");
    }
    if (utils_default.isArrayBuffer(value) || utils_default.isTypedArray(value)) {
      if (useBlob && typeof _Blob === "function") {
        return new _Blob([value]);
      }
      if (typeof Buffer !== "undefined") {
        return Buffer.from(value);
      }
      throw new AxiosError_default("Blob is not supported. Use a Buffer instead.", AxiosError_default.ERR_NOT_SUPPORT);
    }
    return value;
  }
  function throwIfMaxDepthExceeded(depth) {
    if (depth > maxDepth) {
      throw new AxiosError_default(
        "Object is too deeply nested (" + depth + " levels). Max depth: " + maxDepth,
        AxiosError_default.ERR_FORM_DATA_DEPTH_EXCEEDED
      );
    }
  }
  function stringifyWithDepthLimit(value, depth) {
    if (maxDepth === Infinity) {
      return JSON.stringify(value);
    }
    const ancestors = [];
    return JSON.stringify(value, function limitDepth(_key, currentValue) {
      if (!utils_default.isObject(currentValue)) {
        return currentValue;
      }
      while (ancestors.length && ancestors[ancestors.length - 1] !== this) {
        ancestors.pop();
      }
      ancestors.push(currentValue);
      throwIfMaxDepthExceeded(depth + ancestors.length - 1);
      return currentValue;
    });
  }
  function defaultVisitor(value, key, path) {
    let arr = value;
    if (utils_default.isReactNative(formData) && utils_default.isReactNativeBlob(value)) {
      formData.append(renderKey(path, key, dots), convertValue(value));
      return false;
    }
    if (value && !path && typeof value === "object") {
      if (utils_default.endsWith(key, "{}")) {
        key = metaTokens ? key : key.slice(0, -2);
        value = stringifyWithDepthLimit(value, 1);
      } else if (utils_default.isArray(value) && isFlatArray(value) || (utils_default.isFileList(value) || utils_default.endsWith(key, "[]")) && (arr = utils_default.toArray(value))) {
        key = removeBrackets(key);
        arr.forEach(function each(el, index) {
          !(utils_default.isUndefined(el) || el === null) && formData.append(
            // eslint-disable-next-line no-nested-ternary
            indexes === true ? renderKey([key], index, dots) : indexes === null ? key : key + "[]",
            convertValue(el)
          );
        });
        return false;
      }
    }
    if (isVisitable(value)) {
      return true;
    }
    formData.append(renderKey(path, key, dots), convertValue(value));
    return false;
  }
  const exposedHelpers = Object.assign(predicates, {
    defaultVisitor,
    convertValue,
    isVisitable
  });
  function build(value, path, depth = 0) {
    if (utils_default.isUndefined(value)) return;
    throwIfMaxDepthExceeded(depth);
    if (stack.indexOf(value) !== -1) {
      throw new Error("Circular reference detected in " + path.join("."));
    }
    stack.push(value);
    utils_default.forEach(value, function each(el, key) {
      const result = !(utils_default.isUndefined(el) || el === null) && visitor.call(formData, el, utils_default.isString(key) ? key.trim() : key, path, exposedHelpers);
      if (result === true) {
        build(el, path ? path.concat(key) : [key], depth + 1);
      }
    });
    stack.pop();
  }
  if (!utils_default.isObject(obj)) {
    throw new TypeError("data must be an object");
  }
  build(obj);
  return formData;
}
var toFormData_default = toFormData;

// node_modules/axios/lib/helpers/AxiosURLSearchParams.js
function encode(str) {
  const charMap = {
    "!": "%21",
    "'": "%27",
    "(": "%28",
    ")": "%29",
    "~": "%7E",
    "%20": "+"
  };
  return encodeURIComponent(str).replace(/[!'()~]|%20/g, function replacer(match) {
    return charMap[match];
  });
}
function AxiosURLSearchParams(params, options) {
  this._pairs = [];
  params && toFormData_default(params, this, options);
}
var prototype = AxiosURLSearchParams.prototype;
prototype.append = function append(name, value) {
  this._pairs.push([name, value]);
};
prototype.toString = function toString2(encoder) {
  const _encode = encoder ? (value) => encoder.call(this, value, encode) : encode;
  return this._pairs.map(function each(pair) {
    return _encode(pair[0]) + "=" + _encode(pair[1]);
  }, "").join("&");
};
var AxiosURLSearchParams_default = AxiosURLSearchParams;

// node_modules/axios/lib/helpers/buildURL.js
function encode2(val) {
  return encodeURIComponent(val).replace(/%3A/gi, ":").replace(/%24/g, "$").replace(/%2C/gi, ",").replace(/%20/g, "+");
}
function buildURL(url2, params, options) {
  if (!params) {
    return url2;
  }
  url2 = url2 || "";
  const _options = utils_default.isFunction(options) ? {
    serialize: options
  } : options;
  const _encode = utils_default.getSafeProp(_options, "encode") || encode2;
  const serializeFn = utils_default.getSafeProp(_options, "serialize");
  let serializedParams;
  if (serializeFn) {
    serializedParams = serializeFn(params, _options);
  } else {
    serializedParams = utils_default.isURLSearchParams(params) ? params.toString() : new AxiosURLSearchParams_default(params, _options).toString(_encode);
  }
  if (serializedParams) {
    const hashmarkIndex = url2.indexOf("#");
    if (hashmarkIndex !== -1) {
      url2 = url2.slice(0, hashmarkIndex);
    }
    url2 += (url2.indexOf("?") === -1 ? "?" : "&") + serializedParams;
  }
  return url2;
}

// node_modules/axios/lib/core/InterceptorManager.js
var InterceptorManager = class {
  constructor() {
    this.handlers = [];
  }
  /**
   * Add a new interceptor to the stack
   *
   * @param {Function} fulfilled The function to handle `then` for a `Promise`
   * @param {Function} rejected The function to handle `reject` for a `Promise`
   * @param {Object} options The options for the interceptor, synchronous and runWhen
   *
   * @return {Number} An ID used to remove interceptor later
   */
  use(fulfilled, rejected, options) {
    this.handlers.push({
      fulfilled,
      rejected,
      synchronous: options ? options.synchronous : false,
      runWhen: options ? options.runWhen : null
    });
    return this.handlers.length - 1;
  }
  /**
   * Remove an interceptor from the stack
   *
   * @param {Number} id The ID that was returned by `use`
   *
   * @returns {void}
   */
  eject(id) {
    if (this.handlers[id]) {
      this.handlers[id] = null;
    }
  }
  /**
   * Clear all interceptors from the stack
   *
   * @returns {void}
   */
  clear() {
    if (this.handlers) {
      this.handlers = [];
    }
  }
  /**
   * Iterate over all the registered interceptors
   *
   * This method is particularly useful for skipping over any
   * interceptors that may have become `null` calling `eject`.
   *
   * @param {Function} fn The function to call for each interceptor
   *
   * @returns {void}
   */
  forEach(fn) {
    utils_default.forEach(this.handlers, function forEachHandler(h) {
      if (h !== null) {
        fn(h);
      }
    });
  }
};
var InterceptorManager_default = InterceptorManager;

// node_modules/axios/lib/defaults/transitional.js
var transitional_default = {
  silentJSONParsing: true,
  forcedJSONParsing: true,
  clarifyTimeoutError: false,
  legacyInterceptorReqResOrdering: true,
  advertiseZstdAcceptEncoding: false,
  validateStatusUndefinedResolves: true
};

// node_modules/axios/lib/platform/node/index.js
var import_crypto = __toESM(require("crypto"), 1);

// node_modules/axios/lib/platform/node/classes/URLSearchParams.js
var import_url = __toESM(require("url"), 1);
var URLSearchParams_default = import_url.default.URLSearchParams;

// node_modules/axios/lib/platform/node/index.js
var ALPHA = "abcdefghijklmnopqrstuvwxyz";
var DIGIT = "0123456789";
var ALPHABET = {
  DIGIT,
  ALPHA,
  ALPHA_DIGIT: ALPHA + ALPHA.toUpperCase() + DIGIT
};
var generateString = (size = 16, alphabet = ALPHABET.ALPHA_DIGIT) => {
  let str = "";
  const { length } = alphabet;
  const randomValues = new Uint32Array(size);
  import_crypto.default.randomFillSync(randomValues);
  for (let i = 0; i < size; i++) {
    str += alphabet[randomValues[i] % length];
  }
  return str;
};
var node_default = {
  isNode: true,
  classes: {
    URLSearchParams: URLSearchParams_default,
    FormData: FormData_default,
    Blob: typeof Blob !== "undefined" && Blob || null
  },
  ALPHABET,
  generateString,
  protocols: ["http", "https", "file", "data"]
};

// node_modules/axios/lib/platform/common/utils.js
var utils_exports = {};
__export(utils_exports, {
  hasBrowserEnv: () => hasBrowserEnv,
  hasStandardBrowserEnv: () => hasStandardBrowserEnv,
  hasStandardBrowserWebWorkerEnv: () => hasStandardBrowserWebWorkerEnv,
  navigator: () => _navigator,
  origin: () => origin
});
var hasBrowserEnv = typeof window !== "undefined" && typeof document !== "undefined";
var _navigator = typeof navigator === "object" && navigator || void 0;
var hasStandardBrowserEnv = hasBrowserEnv && (!_navigator || ["ReactNative", "NativeScript", "NS"].indexOf(_navigator.product) < 0);
var hasStandardBrowserWebWorkerEnv = (() => {
  return typeof WorkerGlobalScope !== "undefined" && // eslint-disable-next-line no-undef
  self instanceof WorkerGlobalScope && typeof self.importScripts === "function";
})();
var origin = hasBrowserEnv && window.location.href || "http://localhost";

// node_modules/axios/lib/platform/index.js
var platform_default = {
  ...utils_exports,
  ...node_default
};

// node_modules/axios/lib/helpers/toURLEncodedForm.js
function toURLEncodedForm(data, options) {
  return toFormData_default(data, new platform_default.classes.URLSearchParams(), {
    visitor: function(value, key, path, helpers) {
      if (platform_default.isNode && utils_default.isBuffer(value)) {
        this.append(key, value.toString("base64"));
        return false;
      }
      return helpers.defaultVisitor.apply(this, arguments);
    },
    ...options
  });
}

// node_modules/axios/lib/helpers/formDataToJSON.js
var MAX_DEPTH = DEFAULT_FORM_DATA_MAX_DEPTH;
function throwIfDepthExceeded(index) {
  if (index > MAX_DEPTH) {
    throw new AxiosError_default(
      "FormData field is too deeply nested (" + index + " levels). Max depth: " + MAX_DEPTH,
      AxiosError_default.ERR_FORM_DATA_DEPTH_EXCEEDED
    );
  }
}
function parsePropPath(name) {
  const path = [];
  const pattern = /\w+|\[(\w*)]/g;
  let match;
  while ((match = pattern.exec(name)) !== null) {
    throwIfDepthExceeded(path.length);
    path.push(match[0] === "[]" ? "" : match[1] || match[0]);
  }
  return path;
}
function arrayToObject(arr) {
  const obj = {};
  const keys = Object.keys(arr);
  let i;
  const len = keys.length;
  let key;
  for (i = 0; i < len; i++) {
    key = keys[i];
    obj[key] = arr[key];
  }
  return obj;
}
function formDataToJSON(formData) {
  function buildPath(path, value, target, index) {
    throwIfDepthExceeded(index);
    let name = path[index++];
    if (name === "__proto__") return true;
    const isNumericKey = Number.isFinite(+name);
    const isLast = index >= path.length;
    name = !name && utils_default.isArray(target) ? target.length : name;
    if (isLast) {
      if (utils_default.hasOwnProp(target, name)) {
        target[name] = utils_default.isArray(target[name]) ? target[name].concat(value) : [target[name], value];
      } else {
        target[name] = value;
      }
      return !isNumericKey;
    }
    if (!utils_default.hasOwnProp(target, name) || !utils_default.isObject(target[name])) {
      target[name] = [];
    }
    const result = buildPath(path, value, target[name], index);
    if (result && utils_default.isArray(target[name])) {
      target[name] = arrayToObject(target[name]);
    }
    return !isNumericKey;
  }
  if (utils_default.isFormData(formData) && utils_default.isFunction(formData.entries)) {
    const obj = {};
    utils_default.forEachEntry(formData, (name, value) => {
      buildPath(parsePropPath(name), value, obj, 0);
    });
    return obj;
  }
  return null;
}
var formDataToJSON_default = formDataToJSON;

// node_modules/axios/lib/defaults/index.js
var own = (obj, key) => obj != null && utils_default.hasOwnProp(obj, key) ? obj[key] : void 0;
function stringifySafely(rawValue, parser, encoder) {
  if (utils_default.isString(rawValue)) {
    try {
      (parser || JSON.parse)(rawValue);
      return utils_default.trim(rawValue);
    } catch (e) {
      if (e.name !== "SyntaxError") {
        throw e;
      }
    }
  }
  return (encoder || JSON.stringify)(rawValue);
}
var defaults = {
  transitional: transitional_default,
  adapter: ["xhr", "http", "fetch"],
  transformRequest: [
    function transformRequest(data, headers) {
      const contentType = headers.getContentType() || "";
      const hasJSONContentType = contentType.indexOf("application/json") > -1;
      const isObjectPayload = utils_default.isObject(data);
      if (isObjectPayload && utils_default.isHTMLForm(data)) {
        data = new FormData(data);
      }
      const isFormData2 = utils_default.isFormData(data);
      if (isFormData2) {
        return hasJSONContentType ? JSON.stringify(formDataToJSON_default(data)) : data;
      }
      if (utils_default.isArrayBuffer(data) || utils_default.isBuffer(data) || utils_default.isStream(data) || utils_default.isFile(data) || utils_default.isBlob(data) || utils_default.isReadableStream(data)) {
        return data;
      }
      if (utils_default.isArrayBufferView(data)) {
        return data.buffer;
      }
      if (utils_default.isURLSearchParams(data)) {
        headers.setContentType("application/x-www-form-urlencoded;charset=utf-8", false);
        return data.toString();
      }
      let isFileList2;
      if (isObjectPayload) {
        const formSerializer = own(this, "formSerializer");
        if (contentType.indexOf("application/x-www-form-urlencoded") > -1) {
          return toURLEncodedForm(data, formSerializer).toString();
        }
        if ((isFileList2 = utils_default.isFileList(data)) || contentType.indexOf("multipart/form-data") > -1) {
          const env = own(this, "env");
          const _FormData = env && env.FormData;
          return toFormData_default(
            isFileList2 ? { "files[]": data } : data,
            _FormData && new _FormData(),
            formSerializer
          );
        }
      }
      if (isObjectPayload || hasJSONContentType) {
        headers.setContentType("application/json", false);
        return stringifySafely(data);
      }
      return data;
    }
  ],
  transformResponse: [
    function transformResponse(data) {
      const transitional2 = own(this, "transitional") || defaults.transitional;
      const forcedJSONParsing = transitional2 && transitional2.forcedJSONParsing;
      const responseType = own(this, "responseType");
      const JSONRequested = responseType === "json";
      if (utils_default.isResponse(data) || utils_default.isReadableStream(data)) {
        return data;
      }
      if (data && utils_default.isString(data) && (forcedJSONParsing && !responseType || JSONRequested)) {
        const silentJSONParsing = transitional2 && transitional2.silentJSONParsing;
        const strictJSONParsing = !silentJSONParsing && JSONRequested;
        try {
          return JSON.parse(data, own(this, "parseReviver"));
        } catch (e) {
          if (strictJSONParsing) {
            if (e.name === "SyntaxError") {
              throw AxiosError_default.from(e, AxiosError_default.ERR_BAD_RESPONSE, this, null, own(this, "response"));
            }
            throw e;
          }
        }
      }
      return data;
    }
  ],
  /**
   * A timeout in milliseconds to abort a request. If set to 0 (default) a
   * timeout is not created.
   */
  timeout: 0,
  xsrfCookieName: "XSRF-TOKEN",
  xsrfHeaderName: "X-XSRF-TOKEN",
  maxContentLength: -1,
  maxBodyLength: -1,
  env: {
    FormData: platform_default.classes.FormData,
    Blob: platform_default.classes.Blob
  },
  validateStatus: function validateStatus(status) {
    return status >= 200 && status < 300;
  },
  headers: {
    common: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": void 0
    }
  }
};
utils_default.forEach(["delete", "get", "head", "post", "put", "patch", "query"], (method) => {
  defaults.headers[method] = {};
});
var defaults_default = defaults;

// node_modules/axios/lib/core/transformData.js
function transformData(fns, response) {
  const config = this || defaults_default;
  const context = response || config;
  const headers = AxiosHeaders_default.from(context.headers);
  let data = context.data;
  utils_default.forEach(fns, function transform(fn) {
    data = fn.call(config, data, headers.normalize(), response ? response.status : void 0);
  });
  headers.normalize();
  return data;
}

// node_modules/axios/lib/cancel/isCancel.js
function isCancel(value) {
  return !!(value && value.__CANCEL__);
}

// node_modules/axios/lib/cancel/CanceledError.js
var CanceledError = class extends AxiosError_default {
  /**
   * A `CanceledError` is an object that is thrown when an operation is canceled.
   *
   * @param {string=} message The message.
   * @param {Object=} config The config.
   * @param {Object=} request The request.
   *
   * @returns {CanceledError} The created error.
   */
  constructor(message, config, request) {
    super(message == null ? "canceled" : message, AxiosError_default.ERR_CANCELED, config, request);
    this.name = "CanceledError";
    this.__CANCEL__ = true;
  }
};
var CanceledError_default = CanceledError;

// node_modules/axios/lib/core/settle.js
function settle(resolve, reject, response) {
  const validateStatus2 = response.config.validateStatus;
  if (!response.status || !validateStatus2 || validateStatus2(response.status)) {
    resolve(response);
  } else {
    reject(new AxiosError_default(
      "Request failed with status code " + response.status,
      response.status >= 400 && response.status < 500 ? AxiosError_default.ERR_BAD_REQUEST : AxiosError_default.ERR_BAD_RESPONSE,
      response.config,
      response.request,
      response
    ));
  }
}

// node_modules/axios/lib/helpers/isAbsoluteURL.js
function isAbsoluteURL(url2) {
  if (typeof url2 !== "string") {
    return false;
  }
  return /^([a-z][a-z\d+\-.]*:)?\/\//i.test(url2);
}

// node_modules/axios/lib/helpers/combineURLs.js
function combineURLs(baseURL, relativeURL) {
  return relativeURL ? baseURL.replace(/\/?\/$/, "") + "/" + relativeURL.replace(/^\/+/, "") : baseURL;
}

// node_modules/axios/lib/core/buildFullPath.js
var malformedHttpProtocol = /^https?:(?!\/\/)/i;
var httpProtocolControlCharacters = /[\t\n\r]/g;
function stripLeadingC0ControlOrSpace(url2) {
  let i = 0;
  while (i < url2.length && url2.charCodeAt(i) <= 32) {
    i++;
  }
  return url2.slice(i);
}
function normalizeURLForProtocolCheck(url2) {
  return stripLeadingC0ControlOrSpace(url2).replace(httpProtocolControlCharacters, "");
}
function assertValidHttpProtocolURL(url2, config) {
  if (typeof url2 === "string" && malformedHttpProtocol.test(normalizeURLForProtocolCheck(url2))) {
    throw new AxiosError_default(
      'Invalid URL: missing "//" after protocol',
      AxiosError_default.ERR_INVALID_URL,
      config
    );
  }
}
function buildFullPath(baseURL, requestedURL, allowAbsoluteUrls, config) {
  assertValidHttpProtocolURL(requestedURL, config);
  let isRelativeUrl = !isAbsoluteURL(requestedURL);
  if (baseURL && (isRelativeUrl || allowAbsoluteUrls === false)) {
    assertValidHttpProtocolURL(baseURL, config);
    return combineURLs(baseURL, requestedURL);
  }
  return requestedURL;
}

// node_modules/proxy-from-env/index.js
var DEFAULT_PORTS = {
  ftp: 21,
  gopher: 70,
  http: 80,
  https: 443,
  ws: 80,
  wss: 443
};
function parseUrl(urlString) {
  try {
    return new URL(urlString);
  } catch {
    return null;
  }
}
function getProxyForUrl(url2) {
  var parsedUrl = (typeof url2 === "string" ? parseUrl(url2) : url2) || {};
  var proto = parsedUrl.protocol;
  var hostname = parsedUrl.host;
  var port = parsedUrl.port;
  if (typeof hostname !== "string" || !hostname || typeof proto !== "string") {
    return "";
  }
  proto = proto.split(":", 1)[0];
  hostname = hostname.replace(/:\d*$/, "");
  port = parseInt(port) || DEFAULT_PORTS[proto] || 0;
  if (!shouldProxy(hostname, port)) {
    return "";
  }
  var proxy = getEnv(proto + "_proxy") || getEnv("all_proxy");
  if (proxy && proxy.indexOf("://") === -1) {
    proxy = proto + "://" + proxy;
  }
  return proxy;
}
function shouldProxy(hostname, port) {
  var NO_PROXY = getEnv("no_proxy").toLowerCase();
  if (!NO_PROXY) {
    return true;
  }
  if (NO_PROXY === "*") {
    return false;
  }
  return NO_PROXY.split(/[,\s]/).every(function(proxy) {
    if (!proxy) {
      return true;
    }
    var parsedProxy = proxy.match(/^(.+):(\d+)$/);
    var parsedProxyHostname = parsedProxy ? parsedProxy[1] : proxy;
    var parsedProxyPort = parsedProxy ? parseInt(parsedProxy[2]) : 0;
    if (parsedProxyPort && parsedProxyPort !== port) {
      return true;
    }
    if (!/^[.*]/.test(parsedProxyHostname)) {
      return hostname !== parsedProxyHostname;
    }
    if (parsedProxyHostname.charAt(0) === "*") {
      parsedProxyHostname = parsedProxyHostname.slice(1);
    }
    return !hostname.endsWith(parsedProxyHostname);
  });
}
function getEnv(key) {
  return process.env[key.toLowerCase()] || process.env[key.toUpperCase()] || "";
}

// node_modules/axios/lib/adapters/http.js
var import_https_proxy_agent = __toESM(require_dist(), 1);
var import_http = __toESM(require("http"), 1);
var import_https = __toESM(require("https"), 1);
var import_http22 = __toESM(require("http2"), 1);
var import_util3 = __toESM(require("util"), 1);
var import_path = require("path");
var import_follow_redirects = __toESM(require_follow_redirects(), 1);
var import_zlib = __toESM(require("zlib"), 1);

// node_modules/axios/lib/env/data.js
var VERSION = "1.18.1";

// node_modules/axios/lib/helpers/parseProtocol.js
function parseProtocol(url2) {
  const match = /^([-+\w]{1,25}):(?:\/\/)?/.exec(url2);
  return match && match[1] || "";
}

// node_modules/axios/lib/helpers/fromDataURI.js
var DATA_URL_PATTERN = /^([^,;]+\/[^,;]+)?((?:;[^,;=]+=[^,;]+)*)(;base64)?,([\s\S]*)$/;
function fromDataURI(uri, asBlob, options) {
  const _Blob = options && options.Blob || platform_default.classes.Blob;
  const protocol = parseProtocol(uri);
  if (asBlob === void 0 && _Blob) {
    asBlob = true;
  }
  if (protocol === "data") {
    uri = protocol.length ? uri.slice(protocol.length + 1) : uri;
    const match = DATA_URL_PATTERN.exec(uri);
    if (!match) {
      throw new AxiosError_default("Invalid URL", AxiosError_default.ERR_INVALID_URL);
    }
    const type = match[1];
    const params = match[2];
    const encoding = match[3] ? "base64" : "utf8";
    const body = match[4];
    let mime = "";
    if (type) {
      mime = params ? type + params : type;
    } else if (params) {
      mime = "text/plain" + params;
    }
    const buffer = encoding === "base64" ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body), encoding);
    if (asBlob) {
      if (!_Blob) {
        throw new AxiosError_default("Blob is not supported", AxiosError_default.ERR_NOT_SUPPORT);
      }
      return new _Blob([buffer], { type: mime });
    }
    return buffer;
  }
  throw new AxiosError_default("Unsupported protocol " + protocol, AxiosError_default.ERR_NOT_SUPPORT);
}

// node_modules/axios/lib/adapters/http.js
var import_stream4 = __toESM(require("stream"), 1);

// node_modules/axios/lib/helpers/AxiosTransformStream.js
var import_stream = __toESM(require("stream"), 1);
var kInternals = Symbol("internals");
var AxiosTransformStream = class extends import_stream.default.Transform {
  constructor(options) {
    options = utils_default.toFlatObject(
      options,
      {
        maxRate: 0,
        chunkSize: 64 * 1024,
        minChunkSize: 100,
        timeWindow: 500,
        ticksRate: 2,
        samplesCount: 15
      },
      null,
      (prop, source) => {
        return !utils_default.isUndefined(source[prop]);
      }
    );
    super({
      readableHighWaterMark: options.chunkSize
    });
    const internals = this[kInternals] = {
      timeWindow: options.timeWindow,
      chunkSize: options.chunkSize,
      maxRate: options.maxRate,
      minChunkSize: options.minChunkSize,
      bytesSeen: 0,
      isCaptured: false,
      notifiedBytesLoaded: 0,
      ts: Date.now(),
      bytes: 0,
      onReadCallback: null
    };
    this.on("newListener", (event) => {
      if (event === "progress") {
        if (!internals.isCaptured) {
          internals.isCaptured = true;
        }
      }
    });
  }
  _read(size) {
    const internals = this[kInternals];
    if (internals.onReadCallback) {
      internals.onReadCallback();
    }
    return super._read(size);
  }
  _transform(chunk, encoding, callback) {
    const internals = this[kInternals];
    const maxRate = internals.maxRate;
    const readableHighWaterMark = this.readableHighWaterMark;
    const timeWindow = internals.timeWindow;
    const divider = 1e3 / timeWindow;
    const bytesThreshold = maxRate / divider;
    const minChunkSize = internals.minChunkSize !== false ? Math.max(internals.minChunkSize, bytesThreshold * 0.01) : 0;
    const pushChunk = (_chunk, _callback) => {
      const bytes = Buffer.byteLength(_chunk);
      internals.bytesSeen += bytes;
      internals.bytes += bytes;
      internals.isCaptured && this.emit("progress", internals.bytesSeen);
      if (this.push(_chunk)) {
        process.nextTick(_callback);
      } else {
        internals.onReadCallback = () => {
          internals.onReadCallback = null;
          process.nextTick(_callback);
        };
      }
    };
    const transformChunk = (_chunk, _callback) => {
      const chunkSize = Buffer.byteLength(_chunk);
      let chunkRemainder = null;
      let maxChunkSize = readableHighWaterMark;
      let bytesLeft;
      let passed = 0;
      if (maxRate) {
        const now = Date.now();
        if (!internals.ts || (passed = now - internals.ts) >= timeWindow) {
          internals.ts = now;
          bytesLeft = bytesThreshold - internals.bytes;
          internals.bytes = bytesLeft < 0 ? -bytesLeft : 0;
          passed = 0;
        }
        bytesLeft = bytesThreshold - internals.bytes;
      }
      if (maxRate) {
        if (bytesLeft <= 0) {
          return setTimeout(() => {
            _callback(null, _chunk);
          }, timeWindow - passed);
        }
        if (bytesLeft < maxChunkSize) {
          maxChunkSize = bytesLeft;
        }
      }
      if (maxChunkSize && chunkSize > maxChunkSize && chunkSize - maxChunkSize > minChunkSize) {
        chunkRemainder = _chunk.subarray(maxChunkSize);
        _chunk = _chunk.subarray(0, maxChunkSize);
      }
      pushChunk(
        _chunk,
        chunkRemainder ? () => {
          process.nextTick(_callback, null, chunkRemainder);
        } : _callback
      );
    };
    transformChunk(chunk, function transformNextChunk(err, _chunk) {
      if (err) {
        return callback(err);
      }
      if (_chunk) {
        transformChunk(_chunk, transformNextChunk);
      } else {
        callback(null);
      }
    });
  }
};
var AxiosTransformStream_default = AxiosTransformStream;

// node_modules/axios/lib/adapters/http.js
var import_events = require("events");

// node_modules/axios/lib/helpers/formDataToStream.js
var import_util = __toESM(require("util"), 1);
var import_stream2 = require("stream");

// node_modules/axios/lib/helpers/readBlob.js
var { asyncIterator } = Symbol;
var readBlob = async function* (blob) {
  if (blob.stream) {
    yield* blob.stream();
  } else if (blob.arrayBuffer) {
    yield await blob.arrayBuffer();
  } else if (blob[asyncIterator]) {
    yield* blob[asyncIterator]();
  } else {
    yield blob;
  }
};
var readBlob_default = readBlob;

// node_modules/axios/lib/helpers/formDataToStream.js
var BOUNDARY_ALPHABET = platform_default.ALPHABET.ALPHA_DIGIT + "-_";
var textEncoder = typeof TextEncoder === "function" ? new TextEncoder() : new import_util.default.TextEncoder();
var CRLF = "\r\n";
var CRLF_BYTES = textEncoder.encode(CRLF);
var CRLF_BYTES_COUNT = 2;
var FormDataPart = class {
  constructor(name, value) {
    const { escapeName } = this.constructor;
    const isStringValue = utils_default.isString(value);
    let headers = `Content-Disposition: form-data; name="${escapeName(name)}"${!isStringValue && value.name ? `; filename="${escapeName(value.name)}"` : ""}${CRLF}`;
    if (isStringValue) {
      value = textEncoder.encode(String(value).replace(/\r?\n|\r\n?/g, CRLF));
    } else {
      const safeType = String(value.type || "application/octet-stream").replace(/[\r\n]/g, "");
      headers += `Content-Type: ${safeType}${CRLF}`;
    }
    this.headers = textEncoder.encode(headers + CRLF);
    this.contentLength = isStringValue ? value.byteLength : value.size;
    this.size = this.headers.byteLength + this.contentLength + CRLF_BYTES_COUNT;
    this.name = name;
    this.value = value;
  }
  async *encode() {
    yield this.headers;
    const { value } = this;
    if (utils_default.isTypedArray(value)) {
      yield value;
    } else {
      yield* readBlob_default(value);
    }
    yield CRLF_BYTES;
  }
  static escapeName(name) {
    return String(name).replace(
      /[\r\n"]/g,
      (match) => ({
        "\r": "%0D",
        "\n": "%0A",
        '"': "%22"
      })[match]
    );
  }
};
var formDataToStream = (form, headersHandler, options) => {
  const {
    tag = "form-data-boundary",
    size = 25,
    boundary = tag + "-" + platform_default.generateString(size, BOUNDARY_ALPHABET)
  } = options || {};
  if (!utils_default.isFormData(form)) {
    throw new TypeError("FormData instance required");
  }
  if (boundary.length < 1 || boundary.length > 70) {
    throw new Error("boundary must be 1-70 characters long");
  }
  const boundaryBytes = textEncoder.encode("--" + boundary + CRLF);
  const footerBytes = textEncoder.encode("--" + boundary + "--" + CRLF);
  let contentLength = footerBytes.byteLength;
  const parts = Array.from(form.entries()).map(([name, value]) => {
    const part = new FormDataPart(name, value);
    contentLength += part.size;
    return part;
  });
  contentLength += boundaryBytes.byteLength * parts.length;
  contentLength = utils_default.toFiniteNumber(contentLength);
  const computedHeaders = {
    "Content-Type": `multipart/form-data; boundary=${boundary}`
  };
  if (Number.isFinite(contentLength)) {
    computedHeaders["Content-Length"] = contentLength;
  }
  headersHandler && headersHandler(computedHeaders);
  return import_stream2.Readable.from(
    async function* () {
      for (const part of parts) {
        yield boundaryBytes;
        yield* part.encode();
      }
      yield footerBytes;
    }()
  );
};
var formDataToStream_default = formDataToStream;

// node_modules/axios/lib/helpers/ZlibHeaderTransformStream.js
var import_stream3 = __toESM(require("stream"), 1);
var ZlibHeaderTransformStream = class extends import_stream3.default.Transform {
  __transform(chunk, encoding, callback) {
    this.push(chunk);
    callback();
  }
  _transform(chunk, encoding, callback) {
    if (chunk.length !== 0) {
      this._transform = this.__transform;
      if (chunk[0] !== 120) {
        const header = Buffer.alloc(2);
        header[0] = 120;
        header[1] = 156;
        this.push(header, encoding);
      }
    }
    this.__transform(chunk, encoding, callback);
  }
};
var ZlibHeaderTransformStream_default = ZlibHeaderTransformStream;

// node_modules/axios/lib/helpers/Http2Sessions.js
var import_http2 = __toESM(require("http2"), 1);
var import_util2 = __toESM(require("util"), 1);
var Http2Sessions = class {
  constructor() {
    this.sessions = /* @__PURE__ */ Object.create(null);
  }
  getSession(authority, options) {
    options = Object.assign(
      {
        sessionTimeout: 1e3
      },
      options
    );
    let authoritySessions = this.sessions[authority];
    if (authoritySessions) {
      let len = authoritySessions.length;
      for (let i = 0; i < len; i++) {
        const [sessionHandle, sessionOptions] = authoritySessions[i];
        if (!sessionHandle.destroyed && !sessionHandle.closed && import_util2.default.isDeepStrictEqual(sessionOptions, options)) {
          return sessionHandle;
        }
      }
    }
    const session = import_http2.default.connect(authority, options);
    let removed;
    let timer;
    const removeSession = () => {
      if (removed) {
        return;
      }
      removed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      let entries = authoritySessions, len = entries.length, i = len;
      while (i--) {
        if (entries[i][0] === session) {
          if (len === 1) {
            delete this.sessions[authority];
          } else {
            entries.splice(i, 1);
          }
          if (!session.closed) {
            session.close();
          }
          return;
        }
      }
    };
    const originalRequestFn = session.request;
    const { sessionTimeout } = options;
    if (sessionTimeout != null) {
      let streamsCount = 0;
      session.request = function() {
        const stream4 = originalRequestFn.apply(this, arguments);
        streamsCount++;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        stream4.once("close", () => {
          if (!--streamsCount) {
            timer = setTimeout(() => {
              timer = null;
              removeSession();
            }, sessionTimeout);
          }
        });
        return stream4;
      };
    }
    session.once("close", removeSession);
    let entry = [session, options];
    authoritySessions ? authoritySessions.push(entry) : authoritySessions = this.sessions[authority] = [entry];
    return session;
  }
};
var Http2Sessions_default = Http2Sessions;

// node_modules/axios/lib/helpers/callbackify.js
var callbackify = (fn, reducer) => {
  return utils_default.isAsyncFn(fn) ? function(...args) {
    const cb = args.pop();
    fn.apply(this, args).then((value) => {
      try {
        reducer ? cb(null, ...reducer(value)) : cb(null, value);
      } catch (err) {
        cb(err);
      }
    }, cb);
  } : fn;
};
var callbackify_default = callbackify;

// node_modules/axios/lib/helpers/shouldBypassProxy.js
var LOOPBACK_HOSTNAMES = /* @__PURE__ */ new Set(["localhost", "0.0.0.0"]);
var isIPv4Loopback = (host) => {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  if (parts[0] !== "127") return false;
  return parts.every((p) => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
};
var isIPv6ZeroGroup = (group) => /^0{1,4}$/.test(group);
var isIPv6Unspecified = (host) => {
  if (host === "::") return true;
  const compressionIndex = host.indexOf("::");
  if (compressionIndex !== -1) {
    if (compressionIndex !== host.lastIndexOf("::")) return false;
    const left = host.slice(0, compressionIndex);
    const right = host.slice(compressionIndex + 2);
    const leftGroups = left ? left.split(":") : [];
    const rightGroups = right ? right.split(":") : [];
    const explicitGroups = leftGroups.length + rightGroups.length;
    return explicitGroups < 8 && leftGroups.every(isIPv6ZeroGroup) && rightGroups.every(isIPv6ZeroGroup);
  }
  const groups = host.split(":");
  return groups.length === 8 && groups.every(isIPv6ZeroGroup);
};
var isIPv6Loopback = (host) => {
  if (host === "::1") return true;
  const v4MappedDotted = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4MappedDotted) return isIPv4Loopback(v4MappedDotted[1]);
  const v4MappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (v4MappedHex) {
    const high = parseInt(v4MappedHex[1], 16);
    return high >= 32512 && high <= 32767;
  }
  const groups = host.split(":");
  if (groups.length === 8) {
    for (let i = 0; i < 7; i++) {
      if (!/^0+$/.test(groups[i])) return false;
    }
    return /^0*1$/.test(groups[7]);
  }
  return false;
};
var isLoopback = (host) => {
  if (!host) return false;
  if (LOOPBACK_HOSTNAMES.has(host)) return true;
  if (isIPv4Loopback(host)) return true;
  if (isIPv6Unspecified(host)) return true;
  return isIPv6Loopback(host);
};
var DEFAULT_PORTS2 = {
  http: 80,
  https: 443,
  ws: 80,
  wss: 443,
  ftp: 21
};
var parseNoProxyEntry = (entry) => {
  let entryHost = entry;
  let entryPort = 0;
  if (entryHost.charAt(0) === "[") {
    const bracketIndex = entryHost.indexOf("]");
    if (bracketIndex !== -1) {
      const host = entryHost.slice(1, bracketIndex);
      const rest = entryHost.slice(bracketIndex + 1);
      if (rest.charAt(0) === ":" && /^\d+$/.test(rest.slice(1))) {
        entryPort = Number.parseInt(rest.slice(1), 10);
      }
      return [host, entryPort];
    }
  }
  const firstColon = entryHost.indexOf(":");
  const lastColon = entryHost.lastIndexOf(":");
  if (firstColon !== -1 && firstColon === lastColon && /^\d+$/.test(entryHost.slice(lastColon + 1))) {
    entryPort = Number.parseInt(entryHost.slice(lastColon + 1), 10);
    entryHost = entryHost.slice(0, lastColon);
  }
  return [entryHost, entryPort];
};
var IPV4_MAPPED_DOTTED_RE = /^(?:::|(?:0{1,4}:){1,4}:|(?:0{1,4}:){5})ffff:(\d+\.\d+\.\d+\.\d+)$/i;
var IPV4_MAPPED_HEX_RE = /^(?:::|(?:0{1,4}:){1,4}:|(?:0{1,4}:){5})ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;
var unmapIPv4MappedIPv6 = (host) => {
  if (typeof host !== "string" || host.indexOf(":") === -1) return host;
  const dotted = host.match(IPV4_MAPPED_DOTTED_RE);
  if (dotted) return dotted[1];
  const hex = host.match(IPV4_MAPPED_HEX_RE);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return host;
};
var normalizeNoProxyHost = (hostname) => {
  if (!hostname) {
    return hostname;
  }
  if (hostname.charAt(0) === "[" && hostname.charAt(hostname.length - 1) === "]") {
    hostname = hostname.slice(1, -1);
  }
  return unmapIPv4MappedIPv6(hostname.replace(/\.+$/, ""));
};
function shouldBypassProxy(location) {
  let parsed;
  try {
    parsed = new URL(location);
  } catch (_err) {
    return false;
  }
  const noProxy = (process.env.no_proxy || process.env.NO_PROXY || "").toLowerCase();
  if (!noProxy) {
    return false;
  }
  if (noProxy === "*") {
    return true;
  }
  const port = Number.parseInt(parsed.port, 10) || DEFAULT_PORTS2[parsed.protocol.split(":", 1)[0]] || 0;
  const hostname = normalizeNoProxyHost(parsed.hostname.toLowerCase());
  return noProxy.split(/[\s,]+/).some((entry) => {
    if (!entry) {
      return false;
    }
    let [entryHost, entryPort] = parseNoProxyEntry(entry);
    entryHost = normalizeNoProxyHost(entryHost);
    if (!entryHost) {
      return false;
    }
    if (entryPort && entryPort !== port) {
      return false;
    }
    if (entryHost.charAt(0) === "*") {
      entryHost = entryHost.slice(1);
    }
    if (entryHost.charAt(0) === ".") {
      return hostname.endsWith(entryHost);
    }
    return hostname === entryHost || isLoopback(hostname) && isLoopback(entryHost);
  });
}

// node_modules/axios/lib/helpers/speedometer.js
function speedometer(samplesCount, min) {
  samplesCount = samplesCount || 10;
  const bytes = new Array(samplesCount);
  const timestamps = new Array(samplesCount);
  let head = 0;
  let tail = 0;
  let firstSampleTS;
  min = min !== void 0 ? min : 1e3;
  return function push(chunkLength) {
    const now = Date.now();
    const startedAt = timestamps[tail];
    if (!firstSampleTS) {
      firstSampleTS = now;
    }
    bytes[head] = chunkLength;
    timestamps[head] = now;
    let i = tail;
    let bytesCount = 0;
    while (i !== head) {
      bytesCount += bytes[i++];
      i = i % samplesCount;
    }
    head = (head + 1) % samplesCount;
    if (head === tail) {
      tail = (tail + 1) % samplesCount;
    }
    if (now - firstSampleTS < min) {
      return;
    }
    const passed = startedAt && now - startedAt;
    return passed ? Math.round(bytesCount * 1e3 / passed) : void 0;
  };
}
var speedometer_default = speedometer;

// node_modules/axios/lib/helpers/throttle.js
function throttle(fn, freq) {
  let timestamp = 0;
  let threshold = 1e3 / freq;
  let lastArgs;
  let timer;
  const invoke = (args, now = Date.now()) => {
    timestamp = now;
    lastArgs = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    fn(...args);
  };
  const throttled = (...args) => {
    const now = Date.now();
    const passed = now - timestamp;
    if (passed >= threshold) {
      invoke(args, now);
    } else {
      lastArgs = args;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          invoke(lastArgs);
        }, threshold - passed);
      }
    }
  };
  const flush = () => lastArgs && invoke(lastArgs);
  return [throttled, flush];
}
var throttle_default = throttle;

// node_modules/axios/lib/helpers/progressEventReducer.js
var progressEventReducer = (listener, isDownloadStream, freq = 3) => {
  let bytesNotified = 0;
  const _speedometer = speedometer_default(50, 250);
  return throttle_default((e) => {
    if (!e || typeof e.loaded !== "number") {
      return;
    }
    const rawLoaded = e.loaded;
    const total = e.lengthComputable ? e.total : void 0;
    const loaded = total != null ? Math.min(rawLoaded, total) : rawLoaded;
    const progressBytes = Math.max(0, loaded - bytesNotified);
    const rate = _speedometer(progressBytes);
    bytesNotified = Math.max(bytesNotified, loaded);
    const data = {
      loaded,
      total,
      progress: total ? loaded / total : void 0,
      bytes: progressBytes,
      rate: rate ? rate : void 0,
      estimated: rate && total ? (total - loaded) / rate : void 0,
      event: e,
      lengthComputable: total != null,
      [isDownloadStream ? "download" : "upload"]: true
    };
    listener(data);
  }, freq);
};
var progressEventDecorator = (total, throttled) => {
  const lengthComputable = total != null;
  return [
    (loaded) => throttled[0]({
      lengthComputable,
      total,
      loaded
    }),
    throttled[1]
  ];
};
var asyncDecorator = (fn) => (...args) => utils_default.asap(() => fn(...args));

// node_modules/axios/lib/helpers/estimateDataURLDecodedBytes.js
var isHexDigit = (charCode) => charCode >= 48 && charCode <= 57 || charCode >= 65 && charCode <= 70 || charCode >= 97 && charCode <= 102;
var isPercentEncodedByte = (str, i, len) => i + 2 < len && isHexDigit(str.charCodeAt(i + 1)) && isHexDigit(str.charCodeAt(i + 2));
function estimateDataURLDecodedBytes(url2) {
  if (!url2 || typeof url2 !== "string") return 0;
  if (!url2.startsWith("data:")) return 0;
  const comma = url2.indexOf(",");
  if (comma < 0) return 0;
  const meta = url2.slice(5, comma);
  const body = url2.slice(comma + 1);
  const isBase64 = /;base64/i.test(meta);
  if (isBase64) {
    let effectiveLen = body.length;
    const len = body.length;
    for (let i = 0; i < len; i++) {
      if (body.charCodeAt(i) === 37 && i + 2 < len) {
        const a = body.charCodeAt(i + 1);
        const b = body.charCodeAt(i + 2);
        const isHex = isHexDigit(a) && isHexDigit(b);
        if (isHex) {
          effectiveLen -= 2;
          i += 2;
        }
      }
    }
    let pad = 0;
    let idx = len - 1;
    const tailIsPct3D = (j) => j >= 2 && body.charCodeAt(j - 2) === 37 && // '%'
    body.charCodeAt(j - 1) === 51 && // '3'
    (body.charCodeAt(j) === 68 || body.charCodeAt(j) === 100);
    if (idx >= 0) {
      if (body.charCodeAt(idx) === 61) {
        pad++;
        idx--;
      } else if (tailIsPct3D(idx)) {
        pad++;
        idx -= 3;
      }
    }
    if (pad === 1 && idx >= 0) {
      if (body.charCodeAt(idx) === 61) {
        pad++;
      } else if (tailIsPct3D(idx)) {
        pad++;
      }
    }
    const groups = Math.floor(effectiveLen / 4);
    const bytes2 = groups * 3 - (pad || 0);
    return bytes2 > 0 ? bytes2 : 0;
  }
  let bytes = 0;
  for (let i = 0, len = body.length; i < len; i++) {
    const c = body.charCodeAt(i);
    if (c === 37 && isPercentEncodedByte(body, i, len)) {
      bytes += 1;
      i += 2;
    } else if (c < 128) {
      bytes += 1;
    } else if (c < 2048) {
      bytes += 2;
    } else if (c >= 55296 && c <= 56319 && i + 1 < len) {
      const next = body.charCodeAt(i + 1);
      if (next >= 56320 && next <= 57343) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

// node_modules/axios/lib/adapters/http.js
var zlibOptions = {
  flush: import_zlib.default.constants.Z_SYNC_FLUSH,
  finishFlush: import_zlib.default.constants.Z_SYNC_FLUSH
};
var brotliOptions = {
  flush: import_zlib.default.constants.BROTLI_OPERATION_FLUSH,
  finishFlush: import_zlib.default.constants.BROTLI_OPERATION_FLUSH
};
var zstdOptions = {
  flush: import_zlib.default.constants.ZSTD_e_flush,
  finishFlush: import_zlib.default.constants.ZSTD_e_flush
};
var isBrotliSupported = utils_default.isFunction(import_zlib.default.createBrotliDecompress);
var isZstdSupported = utils_default.isFunction(import_zlib.default.createZstdDecompress);
var ACCEPT_ENCODING = "gzip, compress, deflate" + (isBrotliSupported ? ", br" : "");
var ACCEPT_ENCODING_WITH_ZSTD = ACCEPT_ENCODING + (isZstdSupported ? ", zstd" : "");
var { http: httpFollow, https: httpsFollow } = import_follow_redirects.default;
var isHttps = /https:?/;
var FORM_DATA_CONTENT_HEADERS = ["content-type", "content-length"];
function setFormDataHeaders(headers, formHeaders, policy) {
  if (policy !== "content-only") {
    headers.set(formHeaders);
    return;
  }
  Object.entries(formHeaders).forEach(([key, val]) => {
    if (FORM_DATA_CONTENT_HEADERS.includes(key.toLowerCase())) {
      headers.set(key, val);
    }
  });
}
var kAxiosSocketListener = Symbol("axios.http.socketListener");
var kAxiosCurrentReq = Symbol("axios.http.currentReq");
var kAxiosInstalledTunnel = Symbol("axios.http.installedTunnel");
var tunnelingAgentCache = /* @__PURE__ */ new Map();
var tunnelingAgentCacheUser = /* @__PURE__ */ new WeakMap();
var NODE_NATIVE_ENV_PROXY_SUPPORT = {
  22: 21,
  24: 5
};
function isNodeNativeEnvProxySupported(nodeVersion = process.versions && process.versions.node) {
  if (!nodeVersion) {
    return false;
  }
  const [major, minor] = nodeVersion.split(".").map((part) => Number(part));
  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    return false;
  }
  if (major > 24) {
    return true;
  }
  return NODE_NATIVE_ENV_PROXY_SUPPORT[major] != null && minor >= NODE_NATIVE_ENV_PROXY_SUPPORT[major];
}
function isNodeEnvProxyEnabled(agent, nodeVersion = process.versions && process.versions.node) {
  if (!isNodeNativeEnvProxySupported(nodeVersion)) {
    return false;
  }
  const agentOptions = agent && agent.options;
  return Boolean(
    agentOptions && utils_default.hasOwnProp(agentOptions, "proxyEnv") && agentOptions.proxyEnv != null
  );
}
function getProxyEnvAgent(options, configHttpAgent, configHttpsAgent) {
  return isHttps.test(options.protocol) ? configHttpsAgent || import_https.default.globalAgent : configHttpAgent || import_http.default.globalAgent;
}
function getTunnelingAgent(agentOptions, userHttpsAgent) {
  const key = agentOptions.protocol + "//" + agentOptions.hostname + ":" + (agentOptions.port || "") + "#" + (agentOptions.auth || "");
  const cache = userHttpsAgent ? tunnelingAgentCacheUser.get(userHttpsAgent) || tunnelingAgentCacheUser.set(userHttpsAgent, /* @__PURE__ */ new Map()).get(userHttpsAgent) : tunnelingAgentCache;
  let agent = cache.get(key);
  if (agent) return agent;
  const merged = userHttpsAgent && userHttpsAgent.options ? { ...userHttpsAgent.options, ...agentOptions } : agentOptions;
  agent = new import_https_proxy_agent.default(merged);
  if (userHttpsAgent && userHttpsAgent.options) {
    const originTLSOptions = { ...userHttpsAgent.options };
    const callback = agent.callback;
    agent.callback = function axiosTunnelingAgentCallback(req, opts) {
      return callback.call(this, req, { ...originTLSOptions, ...opts });
    };
  }
  agent[kAxiosInstalledTunnel] = true;
  cache.set(key, agent);
  return agent;
}
var supportedProtocols = platform_default.protocols.map((protocol) => {
  return protocol + ":";
});
var decodeURIComponentSafe = (value) => {
  if (!utils_default.isString(value)) {
    return value;
  }
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
};
var flushOnFinish = (stream4, [throttled, flush]) => {
  stream4.on("end", flush).on("error", flush);
  return throttled;
};
var http2Sessions = new Http2Sessions_default();
function dispatchBeforeRedirect(options, responseDetails, requestDetails) {
  if (options.beforeRedirects.proxy) {
    options.beforeRedirects.proxy(options);
  }
  if (options.beforeRedirects.auth) {
    options.beforeRedirects.auth(options);
  }
  if (options.beforeRedirects.sensitiveHeaders) {
    options.beforeRedirects.sensitiveHeaders(options, requestDetails);
  }
  if (options.beforeRedirects.config) {
    options.beforeRedirects.config(options, responseDetails, requestDetails);
  }
}
function stripMatchingHeaders(headers, sensitiveSet) {
  if (!headers) {
    return;
  }
  Object.keys(headers).forEach((header) => {
    if (sensitiveSet.has(header.toLowerCase())) {
      delete headers[header];
    }
  });
}
function isSameOriginRedirect(redirectOptions, requestDetails) {
  if (!requestDetails) {
    return false;
  }
  try {
    return new URL(requestDetails.url).origin === new URL(redirectOptions.href).origin;
  } catch (e) {
    return false;
  }
}
function setProxy(options, configProxy, location, isRedirect, configHttpsAgent, configHttpAgent) {
  let proxy = configProxy;
  const proxyEnvAgent = getProxyEnvAgent(options, configHttpAgent, configHttpsAgent);
  if (!proxy && proxy !== false && !isNodeEnvProxyEnabled(proxyEnvAgent)) {
    const proxyUrl = getProxyForUrl(location);
    if (proxyUrl) {
      if (!shouldBypassProxy(location)) {
        proxy = new URL(proxyUrl);
      }
    }
  }
  if (isRedirect && options.headers) {
    for (const name of Object.keys(options.headers)) {
      if (name.toLowerCase() === "proxy-authorization") {
        delete options.headers[name];
      }
    }
  }
  if (isRedirect && options.agent && options.agent[kAxiosInstalledTunnel]) {
    options.agent = void 0;
  }
  if (proxy) {
    const isProxyURL = proxy instanceof URL;
    const readProxyField = (key) => isProxyURL || utils_default.hasOwnProp(proxy, key) ? proxy[key] : void 0;
    const proxyUsername = readProxyField("username");
    const proxyPassword = readProxyField("password");
    let proxyAuth = utils_default.hasOwnProp(proxy, "auth") ? proxy.auth : void 0;
    if (proxyUsername) {
      proxyAuth = (proxyUsername || "") + ":" + (proxyPassword || "");
    }
    if (proxyAuth) {
      const authIsObject = typeof proxyAuth === "object";
      const authUsername = authIsObject && utils_default.hasOwnProp(proxyAuth, "username") ? proxyAuth.username : void 0;
      const authPassword = authIsObject && utils_default.hasOwnProp(proxyAuth, "password") ? proxyAuth.password : void 0;
      const validProxyAuth = Boolean(authUsername || authPassword);
      if (validProxyAuth) {
        proxyAuth = (authUsername || "") + ":" + (authPassword || "");
      } else if (authIsObject) {
        throw new AxiosError_default("Invalid proxy authorization", AxiosError_default.ERR_BAD_OPTION, { proxy });
      }
    }
    const targetIsHttps = isHttps.test(options.protocol);
    if (targetIsHttps) {
      if (!(configHttpsAgent instanceof import_https_proxy_agent.default)) {
        const proxyHost = readProxyField("hostname") || readProxyField("host");
        const proxyPort = readProxyField("port");
        const rawProxyProtocol = readProxyField("protocol");
        const normalizedProtocol = rawProxyProtocol ? rawProxyProtocol.includes(":") ? rawProxyProtocol : `${rawProxyProtocol}:` : "http:";
        const proxyHostForURL = proxyHost && proxyHost.includes(":") && !proxyHost.startsWith("[") ? `[${proxyHost}]` : proxyHost;
        const proxyURL = new URL(
          `${normalizedProtocol}//${proxyHostForURL}${proxyPort ? ":" + proxyPort : ""}`
        );
        const agentOptions = {
          protocol: proxyURL.protocol,
          hostname: proxyURL.hostname.replace(/^\[|\]$/g, ""),
          port: proxyURL.port,
          auth: proxyAuth && typeof proxyAuth === "string" ? proxyAuth : void 0
        };
        if (proxyURL.protocol === "https:") {
          agentOptions.ALPNProtocols = ["http/1.1"];
        }
        const tunnelingAgent = getTunnelingAgent(agentOptions, configHttpsAgent);
        options.agent = tunnelingAgent;
        if (options.agents) {
          options.agents.https = tunnelingAgent;
        }
      }
    } else {
      if (proxyAuth) {
        const base64 = Buffer.from(proxyAuth, "utf8").toString("base64");
        options.headers["Proxy-Authorization"] = "Basic " + base64;
      }
      let hasUserHostHeader = false;
      for (const name of Object.keys(options.headers)) {
        if (name.toLowerCase() === "host") {
          hasUserHostHeader = true;
          break;
        }
      }
      if (!hasUserHostHeader) {
        options.headers.host = options.hostname + (options.port ? ":" + options.port : "");
      }
      const proxyHost = readProxyField("hostname") || readProxyField("host");
      options.hostname = proxyHost;
      options.host = proxyHost;
      options.port = readProxyField("port");
      options.path = location;
      const proxyProtocol = readProxyField("protocol");
      if (proxyProtocol) {
        options.protocol = proxyProtocol.includes(":") ? proxyProtocol : `${proxyProtocol}:`;
      }
    }
  }
  options.beforeRedirects.proxy = function beforeRedirect(redirectOptions) {
    setProxy(
      redirectOptions,
      configProxy,
      redirectOptions.href,
      true,
      configHttpsAgent,
      configHttpAgent
    );
  };
}
var isHttpAdapterSupported = typeof process !== "undefined" && utils_default.kindOf(process) === "process";
var wrapAsync = (asyncExecutor) => {
  return new Promise((resolve, reject) => {
    let onDone;
    let isDone;
    const done = (value, isRejected) => {
      if (isDone) return;
      isDone = true;
      onDone && onDone(value, isRejected);
    };
    const _resolve = (value) => {
      done(value);
      resolve(value);
    };
    const _reject = (reason) => {
      done(reason, true);
      reject(reason);
    };
    asyncExecutor(_resolve, _reject, (onDoneHandler) => onDone = onDoneHandler).catch(_reject);
  });
};
var resolveFamily = ({ address, family }) => {
  if (!utils_default.isString(address)) {
    throw TypeError("address must be a string");
  }
  return {
    address,
    family: family || (address.indexOf(".") < 0 ? 6 : 4)
  };
};
var buildAddressEntry = (address, family) => resolveFamily(utils_default.isObject(address) ? address : { address, family });
var http2Transport = {
  request(options, cb) {
    const authority = options.protocol + "//" + options.hostname + ":" + (options.port || (options.protocol === "https:" ? 443 : 80));
    const { http2Options, headers } = options;
    const session = http2Sessions.getSession(authority, http2Options);
    const { HTTP2_HEADER_SCHEME, HTTP2_HEADER_METHOD, HTTP2_HEADER_PATH, HTTP2_HEADER_STATUS } = import_http22.default.constants;
    const http2Headers = {
      [HTTP2_HEADER_SCHEME]: options.protocol.replace(":", ""),
      [HTTP2_HEADER_METHOD]: options.method,
      [HTTP2_HEADER_PATH]: options.path
    };
    utils_default.forEach(headers, (header, name) => {
      name.charAt(0) !== ":" && (http2Headers[name] = header);
    });
    const req = session.request(http2Headers);
    req.once("response", (responseHeaders) => {
      const response = req;
      responseHeaders = Object.assign({}, responseHeaders);
      const status = responseHeaders[HTTP2_HEADER_STATUS];
      delete responseHeaders[HTTP2_HEADER_STATUS];
      response.headers = responseHeaders;
      response.statusCode = +status;
      cb(response);
    });
    return req;
  }
};
var http_default = isHttpAdapterSupported && function httpAdapter(config) {
  return wrapAsync(async function dispatchHttpRequest(resolve, reject, onDone) {
    const own2 = (key) => utils_default.getSafeProp(config, key);
    const transitional2 = own2("transitional") || transitional_default;
    let data = own2("data");
    let lookup = own2("lookup");
    let family = own2("family");
    let httpVersion = own2("httpVersion");
    if (httpVersion === void 0) httpVersion = 1;
    let http2Options = own2("http2Options");
    const httpAgent = own2("httpAgent");
    const httpsAgent = own2("httpsAgent");
    const configProxy = own2("proxy");
    const responseType = own2("responseType");
    const responseEncoding = own2("responseEncoding");
    const socketPath = own2("socketPath");
    const method = own2("method").toUpperCase();
    const maxRedirects = own2("maxRedirects");
    const maxBodyLength = own2("maxBodyLength");
    const maxContentLength = own2("maxContentLength");
    const decompress = own2("decompress");
    let isDone;
    let rejected = false;
    let req;
    let connectPhaseTimer;
    httpVersion = +httpVersion;
    if (Number.isNaN(httpVersion)) {
      throw TypeError(`Invalid protocol version: '${config.httpVersion}' is not a number`);
    }
    if (httpVersion !== 1 && httpVersion !== 2) {
      throw TypeError(`Unsupported protocol version '${httpVersion}'`);
    }
    const isHttp2 = httpVersion === 2;
    if (lookup) {
      const _lookup = callbackify_default(lookup, (value) => utils_default.isArray(value) ? value : [value]);
      lookup = (hostname, opt, cb) => {
        _lookup(hostname, opt, (err, arg0, arg1) => {
          if (err) {
            return cb(err);
          }
          const addresses = utils_default.isArray(arg0) ? arg0.map((addr) => buildAddressEntry(addr)) : [buildAddressEntry(arg0, arg1)];
          opt.all ? cb(err, addresses) : cb(err, addresses[0].address, addresses[0].family);
        });
      };
    }
    const abortEmitter = new import_events.EventEmitter();
    function abort(reason) {
      try {
        abortEmitter.emit(
          "abort",
          !reason || reason.type ? new CanceledError_default(null, config, req) : reason
        );
      } catch (err) {
      }
    }
    function clearConnectPhaseTimer() {
      if (connectPhaseTimer) {
        clearTimeout(connectPhaseTimer);
        connectPhaseTimer = null;
      }
    }
    function createTimeoutError() {
      const configTimeout = own2("timeout");
      let timeoutErrorMessage = configTimeout ? "timeout of " + configTimeout + "ms exceeded" : "timeout exceeded";
      const configTimeoutErrorMessage = own2("timeoutErrorMessage");
      if (configTimeoutErrorMessage) {
        timeoutErrorMessage = configTimeoutErrorMessage;
      }
      return new AxiosError_default(
        timeoutErrorMessage,
        transitional2.clarifyTimeoutError ? AxiosError_default.ETIMEDOUT : AxiosError_default.ECONNABORTED,
        config,
        req
      );
    }
    abortEmitter.once("abort", reject);
    const onFinished = () => {
      clearConnectPhaseTimer();
      if (config.cancelToken) {
        config.cancelToken.unsubscribe(abort);
      }
      if (config.signal) {
        config.signal.removeEventListener("abort", abort);
      }
      abortEmitter.removeAllListeners();
    };
    if (config.cancelToken || config.signal) {
      config.cancelToken && config.cancelToken.subscribe(abort);
      if (config.signal) {
        config.signal.aborted ? abort() : config.signal.addEventListener("abort", abort);
      }
    }
    onDone((response, isRejected) => {
      isDone = true;
      clearConnectPhaseTimer();
      if (isRejected) {
        rejected = true;
        onFinished();
        return;
      }
      const { data: data2 } = response;
      if (data2 instanceof import_stream4.default.Readable || data2 instanceof import_stream4.default.Duplex) {
        const offListeners = import_stream4.default.finished(data2, () => {
          offListeners();
          onFinished();
        });
      } else {
        onFinished();
      }
    });
    const fullPath = buildFullPath(own2("baseURL"), own2("url"), own2("allowAbsoluteUrls"), config);
    const urlBase = socketPath ? "http://localhost" : platform_default.hasBrowserEnv ? platform_default.origin : void 0;
    const parsed = new URL(fullPath, urlBase);
    const protocol = parsed.protocol || supportedProtocols[0];
    if (protocol === "data:") {
      if (maxContentLength > -1) {
        const dataUrl = String(own2("url") || fullPath || "");
        const estimated = estimateDataURLDecodedBytes(dataUrl);
        if (estimated > maxContentLength) {
          return reject(
            new AxiosError_default(
              "maxContentLength size of " + maxContentLength + " exceeded",
              AxiosError_default.ERR_BAD_RESPONSE,
              config
            )
          );
        }
      }
      let convertedData;
      if (method !== "GET") {
        return settle(resolve, reject, {
          status: 405,
          statusText: "method not allowed",
          headers: {},
          config
        });
      }
      try {
        convertedData = fromDataURI(own2("url"), responseType === "blob", {
          Blob: config.env && config.env.Blob
        });
      } catch (err) {
        throw AxiosError_default.from(err, AxiosError_default.ERR_BAD_REQUEST, config);
      }
      if (responseType === "text") {
        convertedData = convertedData.toString(responseEncoding);
        if (!responseEncoding || responseEncoding === "utf8") {
          convertedData = utils_default.stripBOM(convertedData);
        }
      } else if (responseType === "stream") {
        convertedData = import_stream4.default.Readable.from(convertedData);
      }
      return settle(resolve, reject, {
        data: convertedData,
        status: 200,
        statusText: "OK",
        headers: new AxiosHeaders_default(),
        config
      });
    }
    if (supportedProtocols.indexOf(protocol) === -1) {
      return reject(
        new AxiosError_default("Unsupported protocol " + protocol, AxiosError_default.ERR_BAD_REQUEST, config)
      );
    }
    const headers = AxiosHeaders_default.from(config.headers).normalize();
    headers.set("User-Agent", "axios/" + VERSION, false);
    const { onUploadProgress, onDownloadProgress } = config;
    const maxRate = config.maxRate;
    let maxUploadRate = void 0;
    let maxDownloadRate = void 0;
    if (utils_default.isSpecCompliantForm(data)) {
      const userBoundary = headers.getContentType(/boundary=([-_\w\d]{10,70})/i);
      data = formDataToStream_default(
        data,
        (formHeaders) => {
          headers.set(formHeaders);
        },
        {
          tag: `axios-${VERSION}-boundary`,
          boundary: userBoundary && userBoundary[1] || void 0
        }
      );
    } else if (utils_default.isFormData(data) && utils_default.isFunction(data.getHeaders) && data.getHeaders !== Object.prototype.getHeaders) {
      setFormDataHeaders(headers, data.getHeaders(), own2("formDataHeaderPolicy"));
      if (!headers.hasContentLength()) {
        try {
          const knownLength = await import_util3.default.promisify(data.getLength).call(data);
          Number.isFinite(knownLength) && knownLength >= 0 && headers.setContentLength(knownLength);
        } catch (e) {
        }
      }
    } else if (utils_default.isBlob(data) || utils_default.isFile(data)) {
      data.size && headers.setContentType(data.type || "application/octet-stream");
      headers.setContentLength(data.size || 0);
      data = import_stream4.default.Readable.from(readBlob_default(data));
    } else if (data && !utils_default.isStream(data)) {
      if (Buffer.isBuffer(data)) {
      } else if (utils_default.isArrayBuffer(data)) {
        data = Buffer.from(new Uint8Array(data));
      } else if (utils_default.isString(data)) {
        data = Buffer.from(data, "utf-8");
      } else {
        return reject(
          new AxiosError_default(
            "Data after transformation must be a string, an ArrayBuffer, a Buffer, or a Stream",
            AxiosError_default.ERR_BAD_REQUEST,
            config
          )
        );
      }
      headers.setContentLength(data.length, false);
      if (maxBodyLength > -1 && data.length > maxBodyLength) {
        return reject(
          new AxiosError_default(
            "Request body larger than maxBodyLength limit",
            AxiosError_default.ERR_BAD_REQUEST,
            config
          )
        );
      }
    }
    const contentLength = utils_default.toFiniteNumber(headers.getContentLength());
    if (utils_default.isArray(maxRate)) {
      maxUploadRate = maxRate[0];
      maxDownloadRate = maxRate[1];
    } else {
      maxUploadRate = maxDownloadRate = maxRate;
    }
    if (data && (onUploadProgress || maxUploadRate)) {
      if (!utils_default.isStream(data)) {
        data = import_stream4.default.Readable.from(data, { objectMode: false });
      }
      data = import_stream4.default.pipeline(
        [
          data,
          new AxiosTransformStream_default({
            maxRate: utils_default.toFiniteNumber(maxUploadRate)
          })
        ],
        utils_default.noop
      );
      onUploadProgress && data.on(
        "progress",
        flushOnFinish(
          data,
          progressEventDecorator(
            contentLength,
            progressEventReducer(asyncDecorator(onUploadProgress), false, 3)
          )
        )
      );
    }
    let auth = void 0;
    const configAuth = own2("auth");
    if (configAuth) {
      const username = utils_default.getSafeProp(configAuth, "username") || "";
      const password = utils_default.getSafeProp(configAuth, "password") || "";
      auth = username + ":" + password;
    }
    if (!auth && (parsed.username || parsed.password)) {
      const urlUsername = decodeURIComponentSafe(parsed.username);
      const urlPassword = decodeURIComponentSafe(parsed.password);
      auth = urlUsername + ":" + urlPassword;
    }
    auth && headers.delete("authorization");
    let path;
    try {
      path = buildURL(
        parsed.pathname + parsed.search,
        own2("params"),
        own2("paramsSerializer")
      ).replace(/^\?/, "");
    } catch (err) {
      return reject(
        AxiosError_default.from(err, AxiosError_default.ERR_BAD_REQUEST, config, null, null, {
          url: own2("url"),
          exists: true
        })
      );
    }
    headers.set(
      "Accept-Encoding",
      utils_default.hasOwnProp(transitional2, "advertiseZstdAcceptEncoding") && transitional2.advertiseZstdAcceptEncoding === true ? ACCEPT_ENCODING_WITH_ZSTD : ACCEPT_ENCODING,
      false
    );
    const options = Object.assign(/* @__PURE__ */ Object.create(null), {
      path,
      method,
      headers: toByteStringHeaderObject(headers),
      agents: { http: httpAgent, https: httpsAgent },
      auth,
      protocol,
      family,
      beforeRedirect: dispatchBeforeRedirect,
      beforeRedirects: /* @__PURE__ */ Object.create(null),
      http2Options
    });
    !utils_default.isUndefined(lookup) && (options.lookup = lookup);
    if (socketPath) {
      if (typeof socketPath !== "string") {
        return reject(
          new AxiosError_default("socketPath must be a string", AxiosError_default.ERR_BAD_OPTION_VALUE, config)
        );
      }
      const allowedSocketPaths = own2("allowedSocketPaths");
      if (allowedSocketPaths != null) {
        const allowed = Array.isArray(allowedSocketPaths) ? allowedSocketPaths : [allowedSocketPaths];
        const resolvedSocket = (0, import_path.resolve)(socketPath);
        const isAllowed = allowed.some(
          (entry) => typeof entry === "string" && (0, import_path.resolve)(entry) === resolvedSocket
        );
        if (!isAllowed) {
          return reject(
            new AxiosError_default(
              `socketPath "${socketPath}" is not permitted by allowedSocketPaths`,
              AxiosError_default.ERR_BAD_OPTION_VALUE,
              config
            )
          );
        }
      }
      options.socketPath = socketPath;
    } else {
      options.hostname = parsed.hostname.startsWith("[") ? parsed.hostname.slice(1, -1) : parsed.hostname;
      options.port = parsed.port;
      setProxy(
        options,
        configProxy,
        protocol + "//" + parsed.hostname + (parsed.port ? ":" + parsed.port : "") + options.path,
        false,
        httpsAgent,
        httpAgent
      );
    }
    let transport;
    let isNativeTransport = false;
    let transportEnforcesMaxBodyLength = false;
    const isHttpsRequest = isHttps.test(options.protocol);
    if (options.agent == null) {
      options.agent = isHttpsRequest ? httpsAgent : httpAgent;
    }
    if (isHttp2) {
      transport = http2Transport;
    } else {
      const configTransport = own2("transport");
      if (configTransport) {
        transport = configTransport;
      } else if (maxRedirects === 0) {
        transport = isHttpsRequest ? import_https.default : import_http.default;
        isNativeTransport = true;
      } else {
        transportEnforcesMaxBodyLength = true;
        options.sensitiveHeaders = [];
        if (maxRedirects) {
          options.maxRedirects = maxRedirects;
        }
        const configBeforeRedirect = own2("beforeRedirect");
        if (configBeforeRedirect) {
          options.beforeRedirects.config = configBeforeRedirect;
        }
        if (auth) {
          const requestOrigin = parsed.origin;
          const authToRestore = auth;
          options.beforeRedirects.auth = function beforeRedirectAuth(redirectOptions) {
            try {
              if (new URL(redirectOptions.href).origin === requestOrigin) {
                redirectOptions.auth = authToRestore;
              }
            } catch (e) {
            }
          };
        }
        const sensitiveHeaders = own2("sensitiveHeaders");
        if (sensitiveHeaders != null) {
          if (!utils_default.isArray(sensitiveHeaders)) {
            return reject(
              new AxiosError_default(
                "sensitiveHeaders must be an array of strings",
                AxiosError_default.ERR_BAD_OPTION_VALUE,
                config
              )
            );
          }
          const sensitiveSet = /* @__PURE__ */ new Set();
          for (const header of sensitiveHeaders) {
            if (!utils_default.isString(header)) {
              return reject(
                new AxiosError_default(
                  "sensitiveHeaders must be an array of strings",
                  AxiosError_default.ERR_BAD_OPTION_VALUE,
                  config
                )
              );
            }
            sensitiveSet.add(header.toLowerCase());
          }
          if (sensitiveSet.size) {
            options.sensitiveHeaders = Array.from(sensitiveSet);
            options.beforeRedirects.sensitiveHeaders = function beforeRedirectSensitiveHeaders(redirectOptions, requestDetails) {
              if (!isSameOriginRedirect(redirectOptions, requestDetails)) {
                stripMatchingHeaders(redirectOptions.headers, sensitiveSet);
              }
            };
          }
        }
        transport = isHttpsRequest ? httpsFollow : httpFollow;
      }
    }
    if (maxBodyLength > -1) {
      options.maxBodyLength = maxBodyLength;
    } else {
      options.maxBodyLength = Infinity;
    }
    options.insecureHTTPParser = Boolean(own2("insecureHTTPParser"));
    req = transport.request(options, function handleResponse(res) {
      clearConnectPhaseTimer();
      if (req.destroyed) return;
      const streams = [res];
      const responseLength = utils_default.toFiniteNumber(res.headers["content-length"]);
      if (onDownloadProgress || maxDownloadRate) {
        const transformStream = new AxiosTransformStream_default({
          maxRate: utils_default.toFiniteNumber(maxDownloadRate)
        });
        onDownloadProgress && transformStream.on(
          "progress",
          flushOnFinish(
            transformStream,
            progressEventDecorator(
              responseLength,
              progressEventReducer(asyncDecorator(onDownloadProgress), true, 3)
            )
          )
        );
        streams.push(transformStream);
      }
      let responseStream = res;
      const lastRequest = res.req || req;
      if (decompress !== false && res.headers["content-encoding"]) {
        if (method === "HEAD" || res.statusCode === 204) {
          delete res.headers["content-encoding"];
        }
        switch ((res.headers["content-encoding"] || "").toLowerCase()) {
          case "gzip":
          case "x-gzip":
          case "compress":
          case "x-compress":
            streams.push(import_zlib.default.createUnzip(zlibOptions));
            delete res.headers["content-encoding"];
            break;
          case "deflate":
            streams.push(new ZlibHeaderTransformStream_default());
            streams.push(import_zlib.default.createUnzip(zlibOptions));
            delete res.headers["content-encoding"];
            break;
          case "br":
            if (isBrotliSupported) {
              streams.push(import_zlib.default.createBrotliDecompress(brotliOptions));
              delete res.headers["content-encoding"];
            }
            break;
          case "zstd":
            if (isZstdSupported) {
              streams.push(import_zlib.default.createZstdDecompress(zstdOptions));
              delete res.headers["content-encoding"];
            }
            break;
        }
      }
      responseStream = streams.length > 1 ? import_stream4.default.pipeline(streams, utils_default.noop) : streams[0];
      const response = {
        status: res.statusCode,
        statusText: res.statusMessage,
        headers: new AxiosHeaders_default(res.headers),
        config,
        request: lastRequest
      };
      if (responseType === "stream") {
        if (maxContentLength > -1) {
          const limit = maxContentLength;
          const source = responseStream;
          async function* enforceMaxContentLength() {
            let totalResponseBytes = 0;
            for await (const chunk of source) {
              totalResponseBytes += chunk.length;
              if (totalResponseBytes > limit) {
                throw new AxiosError_default(
                  "maxContentLength size of " + limit + " exceeded",
                  AxiosError_default.ERR_BAD_RESPONSE,
                  config,
                  lastRequest
                );
              }
              yield chunk;
            }
          }
          responseStream = import_stream4.default.Readable.from(enforceMaxContentLength(), {
            objectMode: false
          });
        }
        response.data = responseStream;
        settle(resolve, reject, response);
      } else {
        const responseBuffer = [];
        let totalResponseBytes = 0;
        responseStream.on("data", function handleStreamData(chunk) {
          responseBuffer.push(chunk);
          totalResponseBytes += chunk.length;
          if (maxContentLength > -1 && totalResponseBytes > maxContentLength) {
            rejected = true;
            responseStream.destroy();
            abort(
              new AxiosError_default(
                "maxContentLength size of " + maxContentLength + " exceeded",
                AxiosError_default.ERR_BAD_RESPONSE,
                config,
                lastRequest
              )
            );
          }
        });
        responseStream.on("aborted", function handlerStreamAborted() {
          if (rejected) {
            return;
          }
          const err = new AxiosError_default(
            "stream has been aborted",
            AxiosError_default.ERR_BAD_RESPONSE,
            config,
            lastRequest,
            response
          );
          responseStream.destroy(err);
          reject(err);
        });
        responseStream.on("error", function handleStreamError(err) {
          if (rejected) return;
          reject(AxiosError_default.from(err, null, config, lastRequest, response));
        });
        responseStream.on("end", function handleStreamEnd() {
          try {
            let responseData = responseBuffer.length === 1 ? responseBuffer[0] : Buffer.concat(responseBuffer);
            if (responseType !== "arraybuffer") {
              responseData = responseData.toString(responseEncoding);
              if (!responseEncoding || responseEncoding === "utf8") {
                responseData = utils_default.stripBOM(responseData);
              }
            }
            response.data = responseData;
          } catch (err) {
            return reject(AxiosError_default.from(err, null, config, response.request, response));
          }
          settle(resolve, reject, response);
        });
      }
      abortEmitter.once("abort", (err) => {
        if (!responseStream.destroyed) {
          responseStream.emit("error", err);
          responseStream.destroy();
        }
      });
    });
    abortEmitter.once("abort", (err) => {
      if (req.close) {
        req.close();
      } else {
        req.destroy(err);
      }
    });
    req.on("error", function handleRequestError(err) {
      reject(AxiosError_default.from(err, null, config, req));
    });
    const boundSockets = /* @__PURE__ */ new Set();
    req.on("socket", function handleRequestSocket(socket) {
      if (typeof socket.setKeepAlive === "function") {
        socket.setKeepAlive(true, 1e3 * 60);
      }
      if (!socket[kAxiosSocketListener]) {
        socket.on("error", function handleSocketError(err) {
          const current = socket[kAxiosCurrentReq];
          if (current && !current.destroyed) {
            current.destroy(err);
          }
        });
        socket[kAxiosSocketListener] = true;
      }
      socket[kAxiosCurrentReq] = req;
      boundSockets.add(socket);
    });
    req.once("close", function clearCurrentReq() {
      clearConnectPhaseTimer();
      for (const socket of boundSockets) {
        if (socket[kAxiosCurrentReq] === req) {
          socket[kAxiosCurrentReq] = null;
        }
      }
      boundSockets.clear();
    });
    if (own2("timeout")) {
      const timeout = parseInt(own2("timeout"), 10);
      if (Number.isNaN(timeout)) {
        abort(
          new AxiosError_default(
            "error trying to parse `config.timeout` to int",
            AxiosError_default.ERR_BAD_OPTION_VALUE,
            config,
            req
          )
        );
        return;
      }
      const handleTimeout = function handleTimeout2() {
        if (isDone) return;
        abort(createTimeoutError());
      };
      if (isNativeTransport && timeout > 0) {
        connectPhaseTimer = setTimeout(handleTimeout, timeout);
      }
      req.setTimeout(timeout, handleTimeout);
    } else {
      req.setTimeout(0);
    }
    if (utils_default.isStream(data)) {
      let ended = false;
      let errored = false;
      data.on("end", () => {
        ended = true;
      });
      data.once("error", (err) => {
        errored = true;
        req.destroy(err);
      });
      data.on("close", () => {
        if (!ended && !errored) {
          abort(new CanceledError_default("Request stream has been aborted", config, req));
        }
      });
      let uploadStream = data;
      if (maxBodyLength > -1 && !transportEnforcesMaxBodyLength) {
        const limit = maxBodyLength;
        let bytesSent = 0;
        uploadStream = import_stream4.default.pipeline(
          [
            data,
            new import_stream4.default.Transform({
              transform(chunk, _enc, cb) {
                bytesSent += chunk.length;
                if (bytesSent > limit) {
                  return cb(
                    new AxiosError_default(
                      "Request body larger than maxBodyLength limit",
                      AxiosError_default.ERR_BAD_REQUEST,
                      config,
                      req
                    )
                  );
                }
                cb(null, chunk);
              }
            })
          ],
          utils_default.noop
        );
        uploadStream.on("error", (err) => {
          if (!req.destroyed) req.destroy(err);
        });
      }
      uploadStream.pipe(req);
    } else {
      data && req.write(data);
      req.end();
    }
  });
};

// node_modules/axios/lib/helpers/isURLSameOrigin.js
var isURLSameOrigin_default = platform_default.hasStandardBrowserEnv ? /* @__PURE__ */ ((origin2, isMSIE) => (url2) => {
  url2 = new URL(url2, platform_default.origin);
  return origin2.protocol === url2.protocol && origin2.host === url2.host && (isMSIE || origin2.port === url2.port);
})(
  new URL(platform_default.origin),
  platform_default.navigator && /(msie|trident)/i.test(platform_default.navigator.userAgent)
) : () => true;

// node_modules/axios/lib/helpers/cookies.js
var cookies_default = platform_default.hasStandardBrowserEnv ? (
  // Standard browser envs support document.cookie
  {
    write(name, value, expires, path, domain, secure, sameSite) {
      if (typeof document === "undefined") return;
      const cookie = [`${name}=${encodeURIComponent(value)}`];
      if (utils_default.isNumber(expires)) {
        cookie.push(`expires=${new Date(expires).toUTCString()}`);
      }
      if (utils_default.isString(path)) {
        cookie.push(`path=${path}`);
      }
      if (utils_default.isString(domain)) {
        cookie.push(`domain=${domain}`);
      }
      if (secure === true) {
        cookie.push("secure");
      }
      if (utils_default.isString(sameSite)) {
        cookie.push(`SameSite=${sameSite}`);
      }
      document.cookie = cookie.join("; ");
    },
    read(name) {
      if (typeof document === "undefined") return null;
      const cookies = document.cookie.split(";");
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i].replace(/^\s+/, "");
        const eq = cookie.indexOf("=");
        if (eq !== -1 && cookie.slice(0, eq) === name) {
          try {
            return decodeURIComponent(cookie.slice(eq + 1));
          } catch (e) {
            return cookie.slice(eq + 1);
          }
        }
      }
      return null;
    },
    remove(name) {
      this.write(name, "", Date.now() - 864e5, "/");
    }
  }
) : (
  // Non-standard browser env (web workers, react-native) lack needed support.
  {
    write() {
    },
    read() {
      return null;
    },
    remove() {
    }
  }
);

// node_modules/axios/lib/core/mergeConfig.js
var headersToObject = (thing) => thing instanceof AxiosHeaders_default ? { ...thing } : thing;
function mergeConfig(config1, config2) {
  config1 = config1 || {};
  config2 = config2 || {};
  const config = /* @__PURE__ */ Object.create(null);
  Object.defineProperty(config, "hasOwnProperty", {
    // Null-proto descriptor so a polluted Object.prototype.get cannot turn
    // this data descriptor into an accessor descriptor on the way in.
    __proto__: null,
    value: Object.prototype.hasOwnProperty,
    enumerable: false,
    writable: true,
    configurable: true
  });
  function getMergedValue(target, source, prop, caseless) {
    if (utils_default.isPlainObject(target) && utils_default.isPlainObject(source)) {
      return utils_default.merge.call({ caseless }, target, source);
    } else if (utils_default.isPlainObject(source)) {
      return utils_default.merge({}, source);
    } else if (utils_default.isArray(source)) {
      return source.slice();
    }
    return source;
  }
  function mergeDeepProperties(a, b, prop, caseless) {
    if (!utils_default.isUndefined(b)) {
      return getMergedValue(a, b, prop, caseless);
    } else if (!utils_default.isUndefined(a)) {
      return getMergedValue(void 0, a, prop, caseless);
    }
  }
  function valueFromConfig2(a, b) {
    if (!utils_default.isUndefined(b)) {
      return getMergedValue(void 0, b);
    }
  }
  function defaultToConfig2(a, b) {
    if (!utils_default.isUndefined(b)) {
      return getMergedValue(void 0, b);
    } else if (!utils_default.isUndefined(a)) {
      return getMergedValue(void 0, a);
    }
  }
  function getMergedTransitionalOption(prop) {
    const transitional2 = utils_default.hasOwnProp(config2, "transitional") ? config2.transitional : void 0;
    if (!utils_default.isUndefined(transitional2)) {
      if (utils_default.isPlainObject(transitional2)) {
        if (utils_default.hasOwnProp(transitional2, prop)) {
          return transitional2[prop];
        }
      } else {
        return void 0;
      }
    }
    const transitional1 = utils_default.hasOwnProp(config1, "transitional") ? config1.transitional : void 0;
    if (utils_default.isPlainObject(transitional1) && utils_default.hasOwnProp(transitional1, prop)) {
      return transitional1[prop];
    }
    return void 0;
  }
  function mergeDirectKeys(a, b, prop) {
    if (utils_default.hasOwnProp(config2, prop)) {
      return getMergedValue(a, b);
    } else if (utils_default.hasOwnProp(config1, prop)) {
      return getMergedValue(void 0, a);
    }
  }
  const mergeMap = {
    url: valueFromConfig2,
    method: valueFromConfig2,
    data: valueFromConfig2,
    baseURL: defaultToConfig2,
    transformRequest: defaultToConfig2,
    transformResponse: defaultToConfig2,
    paramsSerializer: defaultToConfig2,
    timeout: defaultToConfig2,
    timeoutMessage: defaultToConfig2,
    withCredentials: defaultToConfig2,
    withXSRFToken: defaultToConfig2,
    adapter: defaultToConfig2,
    responseType: defaultToConfig2,
    xsrfCookieName: defaultToConfig2,
    xsrfHeaderName: defaultToConfig2,
    onUploadProgress: defaultToConfig2,
    onDownloadProgress: defaultToConfig2,
    decompress: defaultToConfig2,
    maxContentLength: defaultToConfig2,
    maxBodyLength: defaultToConfig2,
    beforeRedirect: defaultToConfig2,
    transport: defaultToConfig2,
    httpAgent: defaultToConfig2,
    httpsAgent: defaultToConfig2,
    cancelToken: defaultToConfig2,
    socketPath: defaultToConfig2,
    allowedSocketPaths: defaultToConfig2,
    responseEncoding: defaultToConfig2,
    validateStatus: mergeDirectKeys,
    headers: (a, b, prop) => mergeDeepProperties(headersToObject(a), headersToObject(b), prop, true)
  };
  utils_default.forEach(Object.keys({ ...config1, ...config2 }), function computeConfigValue(prop) {
    if (prop === "__proto__" || prop === "constructor" || prop === "prototype") return;
    const merge2 = utils_default.hasOwnProp(mergeMap, prop) ? mergeMap[prop] : mergeDeepProperties;
    const a = utils_default.hasOwnProp(config1, prop) ? config1[prop] : void 0;
    const b = utils_default.hasOwnProp(config2, prop) ? config2[prop] : void 0;
    const configValue = merge2(a, b, prop);
    utils_default.isUndefined(configValue) && merge2 !== mergeDirectKeys || (config[prop] = configValue);
  });
  if (utils_default.hasOwnProp(config2, "validateStatus") && utils_default.isUndefined(config2.validateStatus) && getMergedTransitionalOption("validateStatusUndefinedResolves") === false) {
    if (utils_default.hasOwnProp(config1, "validateStatus")) {
      config.validateStatus = getMergedValue(void 0, config1.validateStatus);
    } else {
      delete config.validateStatus;
    }
  }
  return config;
}

// node_modules/axios/lib/helpers/resolveConfig.js
var FORM_DATA_CONTENT_HEADERS2 = ["content-type", "content-length"];
function setFormDataHeaders2(headers, formHeaders, policy) {
  if (policy !== "content-only") {
    headers.set(formHeaders);
    return;
  }
  Object.entries(formHeaders || {}).forEach(([key, val]) => {
    if (FORM_DATA_CONTENT_HEADERS2.includes(key.toLowerCase())) {
      headers.set(key, val);
    }
  });
}
var encodeUTF8 = (str) => encodeURIComponent(str).replace(
  /%([0-9A-F]{2})/gi,
  (_, hex) => String.fromCharCode(parseInt(hex, 16))
);
function resolveConfig(config) {
  const newConfig = mergeConfig({}, config);
  const own2 = (key) => utils_default.hasOwnProp(newConfig, key) ? newConfig[key] : void 0;
  const data = own2("data");
  let withXSRFToken = own2("withXSRFToken");
  const xsrfHeaderName = own2("xsrfHeaderName");
  const xsrfCookieName = own2("xsrfCookieName");
  let headers = own2("headers");
  const auth = own2("auth");
  const baseURL = own2("baseURL");
  const allowAbsoluteUrls = own2("allowAbsoluteUrls");
  const url2 = own2("url");
  newConfig.headers = headers = AxiosHeaders_default.from(headers);
  newConfig.url = buildURL(
    buildFullPath(baseURL, url2, allowAbsoluteUrls, newConfig),
    own2("params"),
    own2("paramsSerializer")
  );
  if (auth) {
    const username = utils_default.getSafeProp(auth, "username") || "";
    const password = utils_default.getSafeProp(auth, "password") || "";
    try {
      headers.set(
        "Authorization",
        "Basic " + btoa(username + ":" + (password ? encodeUTF8(password) : ""))
      );
    } catch (e) {
      throw AxiosError_default.from(e, AxiosError_default.ERR_BAD_OPTION_VALUE, config);
    }
  }
  if (utils_default.isFormData(data)) {
    if (platform_default.hasStandardBrowserEnv || platform_default.hasStandardBrowserWebWorkerEnv || utils_default.isReactNative(data)) {
      headers.setContentType(void 0);
    } else if (utils_default.isFunction(data.getHeaders)) {
      setFormDataHeaders2(headers, data.getHeaders(), own2("formDataHeaderPolicy"));
    }
  }
  if (platform_default.hasStandardBrowserEnv) {
    if (utils_default.isFunction(withXSRFToken)) {
      withXSRFToken = withXSRFToken(newConfig);
    }
    const shouldSendXSRF = withXSRFToken === true || withXSRFToken == null && isURLSameOrigin_default(newConfig.url);
    if (shouldSendXSRF) {
      const xsrfValue = xsrfHeaderName && xsrfCookieName && cookies_default.read(xsrfCookieName);
      if (xsrfValue) {
        headers.set(xsrfHeaderName, xsrfValue);
      }
    }
  }
  return newConfig;
}
var resolveConfig_default = resolveConfig;

// node_modules/axios/lib/adapters/xhr.js
var isXHRAdapterSupported = typeof XMLHttpRequest !== "undefined";
var xhr_default = isXHRAdapterSupported && function(config) {
  return new Promise(function dispatchXhrRequest(resolve, reject) {
    const _config = resolveConfig_default(config);
    let requestData = _config.data;
    const requestHeaders = AxiosHeaders_default.from(_config.headers).normalize();
    let { responseType, onUploadProgress, onDownloadProgress } = _config;
    let onCanceled;
    let uploadThrottled, downloadThrottled;
    let flushUpload, flushDownload;
    function done() {
      flushUpload && flushUpload();
      flushDownload && flushDownload();
      _config.cancelToken && _config.cancelToken.unsubscribe(onCanceled);
      _config.signal && _config.signal.removeEventListener("abort", onCanceled);
    }
    let request = new XMLHttpRequest();
    request.open(_config.method.toUpperCase(), _config.url, true);
    request.timeout = _config.timeout;
    function onloadend() {
      if (!request) {
        return;
      }
      const responseHeaders = AxiosHeaders_default.from(
        "getAllResponseHeaders" in request && request.getAllResponseHeaders()
      );
      const responseData = !responseType || responseType === "text" || responseType === "json" ? request.responseText : request.response;
      const response = {
        data: responseData,
        status: request.status,
        statusText: request.statusText,
        headers: responseHeaders,
        config,
        request
      };
      settle(
        function _resolve(value) {
          resolve(value);
          done();
        },
        function _reject(err) {
          reject(err);
          done();
        },
        response
      );
      request = null;
    }
    if ("onloadend" in request) {
      request.onloadend = onloadend;
    } else {
      request.onreadystatechange = function handleLoad() {
        if (!request || request.readyState !== 4) {
          return;
        }
        if (request.status === 0 && !(request.responseURL && request.responseURL.startsWith("file:"))) {
          return;
        }
        setTimeout(onloadend);
      };
    }
    request.onabort = function handleAbort() {
      if (!request) {
        return;
      }
      reject(new AxiosError_default("Request aborted", AxiosError_default.ECONNABORTED, config, request));
      done();
      request = null;
    };
    request.onerror = function handleError(event) {
      const msg = event && event.message ? event.message : "Network Error";
      const err = new AxiosError_default(msg, AxiosError_default.ERR_NETWORK, config, request);
      err.event = event || null;
      reject(err);
      done();
      request = null;
    };
    request.ontimeout = function handleTimeout() {
      let timeoutErrorMessage = _config.timeout ? "timeout of " + _config.timeout + "ms exceeded" : "timeout exceeded";
      const transitional2 = _config.transitional || transitional_default;
      if (_config.timeoutErrorMessage) {
        timeoutErrorMessage = _config.timeoutErrorMessage;
      }
      reject(
        new AxiosError_default(
          timeoutErrorMessage,
          transitional2.clarifyTimeoutError ? AxiosError_default.ETIMEDOUT : AxiosError_default.ECONNABORTED,
          config,
          request
        )
      );
      done();
      request = null;
    };
    requestData === void 0 && requestHeaders.setContentType(null);
    if ("setRequestHeader" in request) {
      utils_default.forEach(toByteStringHeaderObject(requestHeaders), function setRequestHeader(val, key) {
        request.setRequestHeader(key, val);
      });
    }
    if (!utils_default.isUndefined(_config.withCredentials)) {
      request.withCredentials = !!_config.withCredentials;
    }
    if (responseType && responseType !== "json") {
      request.responseType = _config.responseType;
    }
    if (onDownloadProgress) {
      [downloadThrottled, flushDownload] = progressEventReducer(onDownloadProgress, true);
      request.addEventListener("progress", downloadThrottled);
    }
    if (onUploadProgress && request.upload) {
      [uploadThrottled, flushUpload] = progressEventReducer(onUploadProgress);
      request.upload.addEventListener("progress", uploadThrottled);
      request.upload.addEventListener("loadend", flushUpload);
    }
    if (_config.cancelToken || _config.signal) {
      onCanceled = (cancel) => {
        if (!request) {
          return;
        }
        reject(!cancel || cancel.type ? new CanceledError_default(null, config, request) : cancel);
        request.abort();
        done();
        request = null;
      };
      _config.cancelToken && _config.cancelToken.subscribe(onCanceled);
      if (_config.signal) {
        _config.signal.aborted ? onCanceled() : _config.signal.addEventListener("abort", onCanceled);
      }
    }
    const protocol = parseProtocol(_config.url);
    if (protocol && !platform_default.protocols.includes(protocol)) {
      reject(
        new AxiosError_default(
          "Unsupported protocol " + protocol + ":",
          AxiosError_default.ERR_BAD_REQUEST,
          config
        )
      );
      done();
      return;
    }
    request.send(requestData || null);
  });
};

// node_modules/axios/lib/helpers/composeSignals.js
var composeSignals = (signals, timeout) => {
  signals = signals ? signals.filter(Boolean) : [];
  if (!timeout && !signals.length) {
    return;
  }
  const controller = new AbortController();
  let aborted = false;
  const onabort = function(reason) {
    if (!aborted) {
      aborted = true;
      unsubscribe();
      const err = reason instanceof Error ? reason : this.reason;
      controller.abort(
        err instanceof AxiosError_default ? err : new CanceledError_default(err instanceof Error ? err.message : err)
      );
    }
  };
  let timer = timeout && setTimeout(() => {
    timer = null;
    onabort(new AxiosError_default(`timeout of ${timeout}ms exceeded`, AxiosError_default.ETIMEDOUT));
  }, timeout);
  const unsubscribe = () => {
    if (!signals) {
      return;
    }
    timer && clearTimeout(timer);
    timer = null;
    signals.forEach((signal2) => {
      signal2.unsubscribe ? signal2.unsubscribe(onabort) : signal2.removeEventListener("abort", onabort);
    });
    signals = null;
  };
  signals.forEach((signal2) => signal2.addEventListener("abort", onabort, { once: true }));
  const { signal } = controller;
  signal.unsubscribe = () => utils_default.asap(unsubscribe);
  return signal;
};
var composeSignals_default = composeSignals;

// node_modules/axios/lib/helpers/trackStream.js
var streamChunk = function* (chunk, chunkSize) {
  let len = chunk.byteLength;
  if (!chunkSize || len < chunkSize) {
    yield chunk;
    return;
  }
  let pos = 0;
  let end;
  while (pos < len) {
    end = pos + chunkSize;
    yield chunk.slice(pos, end);
    pos = end;
  }
};
var readBytes = async function* (iterable, chunkSize) {
  for await (const chunk of readStream(iterable)) {
    yield* streamChunk(chunk, chunkSize);
  }
};
var readStream = async function* (stream4) {
  if (stream4[Symbol.asyncIterator]) {
    yield* stream4;
    return;
  }
  const reader = stream4.getReader();
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      yield value;
    }
  } finally {
    await reader.cancel();
  }
};
var trackStream = (stream4, chunkSize, onProgress, onFinish) => {
  const iterator2 = readBytes(stream4, chunkSize);
  let bytes = 0;
  let done;
  let _onFinish = (e) => {
    if (!done) {
      done = true;
      onFinish && onFinish(e);
    }
  };
  return new ReadableStream(
    {
      async pull(controller) {
        try {
          const { done: done2, value } = await iterator2.next();
          if (done2) {
            _onFinish();
            controller.close();
            return;
          }
          let len = value.byteLength;
          if (onProgress) {
            let loadedBytes = bytes += len;
            onProgress(loadedBytes);
          }
          controller.enqueue(new Uint8Array(value));
        } catch (err) {
          _onFinish(err);
          throw err;
        }
      },
      cancel(reason) {
        _onFinish(reason);
        return iterator2.return();
      }
    },
    {
      highWaterMark: 2
    }
  );
};

// node_modules/axios/lib/adapters/fetch.js
var DEFAULT_CHUNK_SIZE = 64 * 1024;
var { isFunction: isFunction2 } = utils_default;
var encodeUTF82 = (str) => encodeURIComponent(str).replace(
  /%([0-9A-F]{2})/gi,
  (_, hex) => String.fromCharCode(parseInt(hex, 16))
);
var decodeURIComponentSafe2 = (value) => {
  if (!utils_default.isString(value)) {
    return value;
  }
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
};
var test = (fn, ...args) => {
  try {
    return !!fn(...args);
  } catch (e) {
    return false;
  }
};
var maybeWithAuthCredentials = (url2) => {
  const protocolIndex = url2.indexOf("://");
  let urlToCheck = url2;
  if (protocolIndex !== -1) {
    urlToCheck = urlToCheck.slice(protocolIndex + 3);
  }
  return urlToCheck.includes("@") || urlToCheck.includes(":");
};
var factory = (env) => {
  const globalObject = utils_default.global !== void 0 && utils_default.global !== null ? utils_default.global : globalThis;
  const { ReadableStream: ReadableStream2, TextEncoder: TextEncoder2 } = globalObject;
  env = utils_default.merge.call(
    {
      skipUndefined: true
    },
    {
      Request: globalObject.Request,
      Response: globalObject.Response
    },
    env
  );
  const { fetch: envFetch, Request, Response } = env;
  const isFetchSupported = envFetch ? isFunction2(envFetch) : typeof fetch === "function";
  const isRequestSupported = isFunction2(Request);
  const isResponseSupported = isFunction2(Response);
  if (!isFetchSupported) {
    return false;
  }
  const isReadableStreamSupported = isFetchSupported && isFunction2(ReadableStream2);
  const encodeText = isFetchSupported && (typeof TextEncoder2 === "function" ? /* @__PURE__ */ ((encoder) => (str) => encoder.encode(str))(new TextEncoder2()) : async (str) => new Uint8Array(await new Request(str).arrayBuffer()));
  const supportsRequestStream = isRequestSupported && isReadableStreamSupported && test(() => {
    let duplexAccessed = false;
    const request = new Request(platform_default.origin, {
      body: new ReadableStream2(),
      method: "POST",
      get duplex() {
        duplexAccessed = true;
        return "half";
      }
    });
    const hasContentType = request.headers.has("Content-Type");
    if (request.body != null) {
      request.body.cancel();
    }
    return duplexAccessed && !hasContentType;
  });
  const supportsResponseStream = isResponseSupported && isReadableStreamSupported && test(() => utils_default.isReadableStream(new Response("").body));
  const resolvers = {
    stream: supportsResponseStream && ((res) => res.body)
  };
  isFetchSupported && (() => {
    ["text", "arrayBuffer", "blob", "formData", "stream"].forEach((type) => {
      !resolvers[type] && (resolvers[type] = (res, config) => {
        let method = res && res[type];
        if (method) {
          return method.call(res);
        }
        throw new AxiosError_default(
          `Response type '${type}' is not supported`,
          AxiosError_default.ERR_NOT_SUPPORT,
          config
        );
      });
    });
  })();
  const getBodyLength = async (body) => {
    if (body == null) {
      return 0;
    }
    if (utils_default.isBlob(body)) {
      return body.size;
    }
    if (utils_default.isSpecCompliantForm(body)) {
      const _request = new Request(platform_default.origin, {
        method: "POST",
        body
      });
      return (await _request.arrayBuffer()).byteLength;
    }
    if (utils_default.isArrayBufferView(body) || utils_default.isArrayBuffer(body)) {
      return body.byteLength;
    }
    if (utils_default.isURLSearchParams(body)) {
      body = body + "";
    }
    if (utils_default.isString(body)) {
      return (await encodeText(body)).byteLength;
    }
  };
  const resolveBodyLength = async (headers, body) => {
    const length = utils_default.toFiniteNumber(headers.getContentLength());
    return length == null ? getBodyLength(body) : length;
  };
  return async (config) => {
    let {
      url: url2,
      method,
      data,
      signal,
      cancelToken,
      timeout,
      onDownloadProgress,
      onUploadProgress,
      responseType,
      headers,
      withCredentials = "same-origin",
      fetchOptions,
      maxContentLength,
      maxBodyLength
    } = resolveConfig_default(config);
    const hasMaxContentLength = utils_default.isNumber(maxContentLength) && maxContentLength > -1;
    const hasMaxBodyLength = utils_default.isNumber(maxBodyLength) && maxBodyLength > -1;
    const own2 = (key) => utils_default.hasOwnProp(config, key) ? config[key] : void 0;
    let _fetch = envFetch || fetch;
    responseType = responseType ? (responseType + "").toLowerCase() : "text";
    let composedSignal = composeSignals_default(
      [signal, cancelToken && cancelToken.toAbortSignal()],
      timeout
    );
    let request = null;
    const unsubscribe = composedSignal && composedSignal.unsubscribe && (() => {
      composedSignal.unsubscribe();
    });
    let requestContentLength;
    let pendingBodyError = null;
    const maxBodyLengthError = () => new AxiosError_default(
      "Request body larger than maxBodyLength limit",
      AxiosError_default.ERR_BAD_REQUEST,
      config,
      request
    );
    try {
      let auth = void 0;
      const configAuth = own2("auth");
      if (configAuth) {
        const username = utils_default.getSafeProp(configAuth, "username") || "";
        const password = utils_default.getSafeProp(configAuth, "password") || "";
        auth = {
          username,
          password
        };
      }
      if (maybeWithAuthCredentials(url2)) {
        const parsedURL = new URL(url2, platform_default.origin);
        if (!auth && (parsedURL.username || parsedURL.password)) {
          const urlUsername = decodeURIComponentSafe2(parsedURL.username);
          const urlPassword = decodeURIComponentSafe2(parsedURL.password);
          auth = {
            username: urlUsername,
            password: urlPassword
          };
        }
        if (parsedURL.username || parsedURL.password) {
          parsedURL.username = "";
          parsedURL.password = "";
          url2 = parsedURL.href;
        }
      }
      if (auth) {
        headers.delete("authorization");
        headers.set(
          "Authorization",
          "Basic " + btoa(encodeUTF82((auth.username || "") + ":" + (auth.password || "")))
        );
      }
      if (hasMaxContentLength && typeof url2 === "string" && url2.startsWith("data:")) {
        const estimated = estimateDataURLDecodedBytes(url2);
        if (estimated > maxContentLength) {
          throw new AxiosError_default(
            "maxContentLength size of " + maxContentLength + " exceeded",
            AxiosError_default.ERR_BAD_RESPONSE,
            config,
            request
          );
        }
      }
      if (hasMaxBodyLength && method !== "get" && method !== "head") {
        const outboundLength = await getBodyLength(data);
        if (typeof outboundLength === "number" && isFinite(outboundLength)) {
          requestContentLength = outboundLength;
          if (outboundLength > maxBodyLength) {
            throw maxBodyLengthError();
          }
        }
      }
      const mustEnforceStreamBody = hasMaxBodyLength && (utils_default.isReadableStream(data) || utils_default.isStream(data));
      const trackRequestStream = (stream4, onProgress, flush) => trackStream(
        stream4,
        DEFAULT_CHUNK_SIZE,
        (loadedBytes) => {
          if (hasMaxBodyLength && loadedBytes > maxBodyLength) {
            throw pendingBodyError = maxBodyLengthError();
          }
          onProgress && onProgress(loadedBytes);
        },
        flush
      );
      if (supportsRequestStream && method !== "get" && method !== "head" && (onUploadProgress || mustEnforceStreamBody)) {
        requestContentLength = requestContentLength == null ? await resolveBodyLength(headers, data) : requestContentLength;
        if (requestContentLength !== 0 || mustEnforceStreamBody) {
          let _request = new Request(url2, {
            method: "POST",
            body: data,
            duplex: "half"
          });
          let contentTypeHeader;
          if (utils_default.isFormData(data) && (contentTypeHeader = _request.headers.get("content-type"))) {
            headers.setContentType(contentTypeHeader);
          }
          if (_request.body) {
            const [onProgress, flush] = onUploadProgress && progressEventDecorator(
              requestContentLength,
              progressEventReducer(asyncDecorator(onUploadProgress))
            ) || [];
            data = trackRequestStream(_request.body, onProgress, flush);
          }
        }
      } else if (mustEnforceStreamBody && !isRequestSupported && isReadableStreamSupported && method !== "get" && method !== "head") {
        data = trackRequestStream(data);
      } else if (mustEnforceStreamBody && isRequestSupported && !supportsRequestStream && method !== "get" && method !== "head") {
        throw new AxiosError_default(
          "Stream request bodies are not supported by the current fetch implementation",
          AxiosError_default.ERR_NOT_SUPPORT,
          config,
          request
        );
      }
      if (!utils_default.isString(withCredentials)) {
        withCredentials = withCredentials ? "include" : "omit";
      }
      const isCredentialsSupported = isRequestSupported && "credentials" in Request.prototype;
      if (utils_default.isFormData(data)) {
        const contentType = headers.getContentType();
        if (contentType && /^multipart\/form-data/i.test(contentType) && !/boundary=/i.test(contentType)) {
          headers.delete("content-type");
        }
      }
      headers.set("User-Agent", "axios/" + VERSION, false);
      const resolvedOptions = {
        ...fetchOptions,
        signal: composedSignal,
        method: method.toUpperCase(),
        headers: toByteStringHeaderObject(headers.normalize()),
        body: data,
        duplex: "half",
        credentials: isCredentialsSupported ? withCredentials : void 0
      };
      request = isRequestSupported && new Request(url2, resolvedOptions);
      let response = await (isRequestSupported ? _fetch(request, fetchOptions) : _fetch(url2, resolvedOptions));
      const responseHeaders = AxiosHeaders_default.from(response.headers);
      if (hasMaxContentLength) {
        const declaredLength = utils_default.toFiniteNumber(responseHeaders.getContentLength());
        if (declaredLength != null && declaredLength > maxContentLength) {
          throw new AxiosError_default(
            "maxContentLength size of " + maxContentLength + " exceeded",
            AxiosError_default.ERR_BAD_RESPONSE,
            config,
            request
          );
        }
      }
      const isStreamResponse = supportsResponseStream && (responseType === "stream" || responseType === "response");
      if (supportsResponseStream && response.body && (onDownloadProgress || hasMaxContentLength || isStreamResponse && unsubscribe)) {
        const options = {};
        ["status", "statusText", "headers"].forEach((prop) => {
          options[prop] = response[prop];
        });
        const responseContentLength = utils_default.toFiniteNumber(responseHeaders.getContentLength());
        const [onProgress, flush] = onDownloadProgress && progressEventDecorator(
          responseContentLength,
          progressEventReducer(asyncDecorator(onDownloadProgress), true)
        ) || [];
        let bytesRead = 0;
        const onChunkProgress = (loadedBytes) => {
          if (hasMaxContentLength) {
            bytesRead = loadedBytes;
            if (bytesRead > maxContentLength) {
              throw new AxiosError_default(
                "maxContentLength size of " + maxContentLength + " exceeded",
                AxiosError_default.ERR_BAD_RESPONSE,
                config,
                request
              );
            }
          }
          onProgress && onProgress(loadedBytes);
        };
        response = new Response(
          trackStream(response.body, DEFAULT_CHUNK_SIZE, onChunkProgress, () => {
            flush && flush();
            unsubscribe && unsubscribe();
          }),
          options
        );
      }
      responseType = responseType || "text";
      let responseData = await resolvers[utils_default.findKey(resolvers, responseType) || "text"](
        response,
        config
      );
      if (hasMaxContentLength && !supportsResponseStream && !isStreamResponse) {
        let materializedSize;
        if (responseData != null) {
          if (typeof responseData.byteLength === "number") {
            materializedSize = responseData.byteLength;
          } else if (typeof responseData.size === "number") {
            materializedSize = responseData.size;
          } else if (typeof responseData === "string") {
            materializedSize = typeof TextEncoder2 === "function" ? new TextEncoder2().encode(responseData).byteLength : responseData.length;
          }
        }
        if (typeof materializedSize === "number" && materializedSize > maxContentLength) {
          throw new AxiosError_default(
            "maxContentLength size of " + maxContentLength + " exceeded",
            AxiosError_default.ERR_BAD_RESPONSE,
            config,
            request
          );
        }
      }
      !isStreamResponse && unsubscribe && unsubscribe();
      return await new Promise((resolve, reject) => {
        settle(resolve, reject, {
          data: responseData,
          headers: AxiosHeaders_default.from(response.headers),
          status: response.status,
          statusText: response.statusText,
          config,
          request
        });
      });
    } catch (err) {
      unsubscribe && unsubscribe();
      if (composedSignal && composedSignal.aborted && composedSignal.reason instanceof AxiosError_default) {
        const canceledError = composedSignal.reason;
        canceledError.config = config;
        request && (canceledError.request = request);
        if (err !== canceledError) {
          Object.defineProperty(canceledError, "cause", {
            __proto__: null,
            value: err,
            writable: true,
            enumerable: false,
            configurable: true
          });
        }
        throw canceledError;
      }
      if (pendingBodyError) {
        request && !pendingBodyError.request && (pendingBodyError.request = request);
        throw pendingBodyError;
      }
      if (err instanceof AxiosError_default) {
        request && !err.request && (err.request = request);
        throw err;
      }
      if (err && err.name === "TypeError" && /Load failed|fetch/i.test(err.message)) {
        const networkError = new AxiosError_default(
          "Network Error",
          AxiosError_default.ERR_NETWORK,
          config,
          request,
          err && err.response
        );
        Object.defineProperty(networkError, "cause", {
          __proto__: null,
          value: err.cause || err,
          writable: true,
          enumerable: false,
          configurable: true
        });
        throw networkError;
      }
      throw AxiosError_default.from(err, err && err.code, config, request, err && err.response);
    }
  };
};
var seedCache = /* @__PURE__ */ new Map();
var getFetch = (config) => {
  let env = config && config.env || {};
  const { fetch: fetch2, Request, Response } = env;
  const seeds = [Request, Response, fetch2];
  let len = seeds.length, i = len, seed, target, map = seedCache;
  while (i--) {
    seed = seeds[i];
    target = map.get(seed);
    target === void 0 && map.set(seed, target = i ? /* @__PURE__ */ new Map() : factory(env));
    map = target;
  }
  return target;
};
var adapter = getFetch();

// node_modules/axios/lib/adapters/adapters.js
var knownAdapters = {
  http: http_default,
  xhr: xhr_default,
  fetch: {
    get: getFetch
  }
};
utils_default.forEach(knownAdapters, (fn, value) => {
  if (fn) {
    try {
      Object.defineProperty(fn, "name", { __proto__: null, value });
    } catch (e) {
    }
    Object.defineProperty(fn, "adapterName", { __proto__: null, value });
  }
});
var renderReason = (reason) => `- ${reason}`;
var isResolvedHandle = (adapter2) => utils_default.isFunction(adapter2) || adapter2 === null || adapter2 === false;
function getAdapter(adapters, config) {
  adapters = utils_default.isArray(adapters) ? adapters : [adapters];
  const { length } = adapters;
  let nameOrAdapter;
  let adapter2;
  const rejectedReasons = {};
  for (let i = 0; i < length; i++) {
    nameOrAdapter = adapters[i];
    let id;
    adapter2 = nameOrAdapter;
    if (!isResolvedHandle(nameOrAdapter)) {
      adapter2 = knownAdapters[(id = String(nameOrAdapter)).toLowerCase()];
      if (adapter2 === void 0) {
        throw new AxiosError_default(`Unknown adapter '${id}'`);
      }
    }
    if (adapter2 && (utils_default.isFunction(adapter2) || (adapter2 = adapter2.get(config)))) {
      break;
    }
    rejectedReasons[id || "#" + i] = adapter2;
  }
  if (!adapter2) {
    const reasons = Object.entries(rejectedReasons).map(
      ([id, state]) => `adapter ${id} ` + (state === false ? "is not supported by the environment" : "is not available in the build")
    );
    let s = length ? reasons.length > 1 ? "since :\n" + reasons.map(renderReason).join("\n") : " " + renderReason(reasons[0]) : "as no adapter specified";
    throw new AxiosError_default(
      `There is no suitable adapter to dispatch the request ` + s,
      AxiosError_default.ERR_NOT_SUPPORT
    );
  }
  return adapter2;
}
var adapters_default = {
  /**
   * Resolve an adapter from a list of adapter names or functions.
   * @type {Function}
   */
  getAdapter,
  /**
   * Exposes all known adapters
   * @type {Object<string, Function|Object>}
   */
  adapters: knownAdapters
};

// node_modules/axios/lib/core/dispatchRequest.js
function throwIfCancellationRequested(config) {
  if (config.cancelToken) {
    config.cancelToken.throwIfRequested();
  }
  if (config.signal && config.signal.aborted) {
    throw new CanceledError_default(null, config);
  }
}
function dispatchRequest(config) {
  throwIfCancellationRequested(config);
  config.headers = AxiosHeaders_default.from(config.headers);
  config.data = transformData.call(config, config.transformRequest);
  if (["post", "put", "patch"].indexOf(config.method) !== -1) {
    config.headers.setContentType("application/x-www-form-urlencoded", false);
  }
  const adapter2 = adapters_default.getAdapter(config.adapter || defaults_default.adapter, config);
  return adapter2(config).then(
    function onAdapterResolution(response) {
      throwIfCancellationRequested(config);
      config.response = response;
      try {
        response.data = transformData.call(config, config.transformResponse, response);
      } finally {
        delete config.response;
      }
      response.headers = AxiosHeaders_default.from(response.headers);
      return response;
    },
    function onAdapterRejection(reason) {
      if (!isCancel(reason)) {
        throwIfCancellationRequested(config);
        if (reason && reason.response) {
          config.response = reason.response;
          try {
            reason.response.data = transformData.call(
              config,
              config.transformResponse,
              reason.response
            );
          } finally {
            delete config.response;
          }
          reason.response.headers = AxiosHeaders_default.from(reason.response.headers);
        }
      }
      return Promise.reject(reason);
    }
  );
}

// node_modules/axios/lib/helpers/validator.js
var validators = {};
["object", "boolean", "number", "function", "string", "symbol"].forEach((type, i) => {
  validators[type] = function validator(thing) {
    return typeof thing === type || "a" + (i < 1 ? "n " : " ") + type;
  };
});
var deprecatedWarnings = {};
validators.transitional = function transitional(validator, version, message) {
  function formatMessage(opt, desc) {
    return "[Axios v" + VERSION + "] Transitional option '" + opt + "'" + desc + (message ? ". " + message : "");
  }
  return (value, opt, opts) => {
    if (validator === false) {
      throw new AxiosError_default(
        formatMessage(opt, " has been removed" + (version ? " in " + version : "")),
        AxiosError_default.ERR_DEPRECATED
      );
    }
    if (version && !deprecatedWarnings[opt]) {
      deprecatedWarnings[opt] = true;
      console.warn(
        formatMessage(
          opt,
          " has been deprecated since v" + version + " and will be removed in the near future"
        )
      );
    }
    return validator ? validator(value, opt, opts) : true;
  };
};
validators.spelling = function spelling(correctSpelling) {
  return (value, opt) => {
    console.warn(`${opt} is likely a misspelling of ${correctSpelling}`);
    return true;
  };
};
function assertOptions(options, schema, allowUnknown) {
  if (typeof options !== "object" || options === null) {
    throw new AxiosError_default("options must be an object", AxiosError_default.ERR_BAD_OPTION_VALUE);
  }
  const keys = Object.keys(options);
  let i = keys.length;
  while (i-- > 0) {
    const opt = keys[i];
    const validator = Object.prototype.hasOwnProperty.call(schema, opt) ? schema[opt] : void 0;
    if (validator) {
      const value = options[opt];
      const result = value === void 0 || validator(value, opt, options);
      if (result !== true) {
        throw new AxiosError_default(
          "option " + opt + " must be " + result,
          AxiosError_default.ERR_BAD_OPTION_VALUE
        );
      }
      continue;
    }
    if (allowUnknown !== true) {
      throw new AxiosError_default("Unknown option " + opt, AxiosError_default.ERR_BAD_OPTION);
    }
  }
}
var validator_default = {
  assertOptions,
  validators
};

// node_modules/axios/lib/core/Axios.js
var validators2 = validator_default.validators;
var Axios = class {
  constructor(instanceConfig) {
    this.defaults = instanceConfig || {};
    this.interceptors = {
      request: new InterceptorManager_default(),
      response: new InterceptorManager_default()
    };
  }
  /**
   * Dispatch a request
   *
   * @param {String|Object} configOrUrl The config specific for this request (merged with this.defaults)
   * @param {?Object} config
   *
   * @returns {Promise} The Promise to be fulfilled
   */
  async request(configOrUrl, config) {
    try {
      return await this._request(configOrUrl, config);
    } catch (err) {
      if (err instanceof Error) {
        let dummy = {};
        Error.captureStackTrace ? Error.captureStackTrace(dummy) : dummy = new Error();
        const stack = (() => {
          if (!dummy.stack) {
            return "";
          }
          const firstNewlineIndex = dummy.stack.indexOf("\n");
          return firstNewlineIndex === -1 ? "" : dummy.stack.slice(firstNewlineIndex + 1);
        })();
        try {
          if (!err.stack) {
            err.stack = stack;
          } else if (stack) {
            const firstNewlineIndex = stack.indexOf("\n");
            const secondNewlineIndex = firstNewlineIndex === -1 ? -1 : stack.indexOf("\n", firstNewlineIndex + 1);
            const stackWithoutTwoTopLines = secondNewlineIndex === -1 ? "" : stack.slice(secondNewlineIndex + 1);
            if (!String(err.stack).endsWith(stackWithoutTwoTopLines)) {
              err.stack += "\n" + stack;
            }
          }
        } catch (e) {
        }
      }
      throw err;
    }
  }
  _request(configOrUrl, config) {
    if (typeof configOrUrl === "string") {
      config = config || {};
      config.url = configOrUrl;
    } else {
      config = configOrUrl || {};
    }
    config = mergeConfig(this.defaults, config);
    const { transitional: transitional2, paramsSerializer, headers } = config;
    if (transitional2 !== void 0) {
      validator_default.assertOptions(
        transitional2,
        {
          silentJSONParsing: validators2.transitional(validators2.boolean),
          forcedJSONParsing: validators2.transitional(validators2.boolean),
          clarifyTimeoutError: validators2.transitional(validators2.boolean),
          legacyInterceptorReqResOrdering: validators2.transitional(validators2.boolean),
          advertiseZstdAcceptEncoding: validators2.transitional(validators2.boolean),
          validateStatusUndefinedResolves: validators2.transitional(validators2.boolean)
        },
        false
      );
    }
    if (paramsSerializer != null) {
      if (utils_default.isFunction(paramsSerializer)) {
        config.paramsSerializer = {
          serialize: paramsSerializer
        };
      } else {
        validator_default.assertOptions(
          paramsSerializer,
          {
            encode: validators2.function,
            serialize: validators2.function
          },
          true
        );
      }
    }
    if (config.allowAbsoluteUrls !== void 0) {
    } else if (this.defaults.allowAbsoluteUrls !== void 0) {
      config.allowAbsoluteUrls = this.defaults.allowAbsoluteUrls;
    } else {
      config.allowAbsoluteUrls = true;
    }
    validator_default.assertOptions(
      config,
      {
        baseUrl: validators2.spelling("baseURL"),
        withXsrfToken: validators2.spelling("withXSRFToken")
      },
      true
    );
    config.method = (config.method || this.defaults.method || "get").toLowerCase();
    let contextHeaders = headers && utils_default.merge(headers.common, headers[config.method]);
    headers && utils_default.forEach(["delete", "get", "head", "post", "put", "patch", "query", "common"], (method) => {
      delete headers[method];
    });
    config.headers = AxiosHeaders_default.concat(contextHeaders, headers);
    const requestInterceptorChain = [];
    let synchronousRequestInterceptors = true;
    this.interceptors.request.forEach(function unshiftRequestInterceptors(interceptor) {
      if (typeof interceptor.runWhen === "function" && interceptor.runWhen(config) === false) {
        return;
      }
      synchronousRequestInterceptors = synchronousRequestInterceptors && interceptor.synchronous;
      const transitional3 = config.transitional || transitional_default;
      const legacyInterceptorReqResOrdering = transitional3 && transitional3.legacyInterceptorReqResOrdering;
      if (legacyInterceptorReqResOrdering) {
        requestInterceptorChain.unshift(interceptor.fulfilled, interceptor.rejected);
      } else {
        requestInterceptorChain.push(interceptor.fulfilled, interceptor.rejected);
      }
    });
    const responseInterceptorChain = [];
    this.interceptors.response.forEach(function pushResponseInterceptors(interceptor) {
      responseInterceptorChain.push(interceptor.fulfilled, interceptor.rejected);
    });
    let promise;
    let i = 0;
    let len;
    if (!synchronousRequestInterceptors) {
      const chain = [dispatchRequest.bind(this), void 0];
      chain.unshift(...requestInterceptorChain);
      chain.push(...responseInterceptorChain);
      len = chain.length;
      promise = Promise.resolve(config);
      while (i < len) {
        promise = promise.then(chain[i++], chain[i++]);
      }
      return promise;
    }
    len = requestInterceptorChain.length;
    let newConfig = config;
    while (i < len) {
      const onFulfilled = requestInterceptorChain[i++];
      const onRejected = requestInterceptorChain[i++];
      try {
        newConfig = onFulfilled(newConfig);
      } catch (error) {
        onRejected.call(this, error);
        break;
      }
    }
    try {
      promise = dispatchRequest.call(this, newConfig);
    } catch (error) {
      return Promise.reject(error);
    }
    i = 0;
    len = responseInterceptorChain.length;
    while (i < len) {
      promise = promise.then(responseInterceptorChain[i++], responseInterceptorChain[i++]);
    }
    return promise;
  }
  getUri(config) {
    config = mergeConfig(this.defaults, config);
    const fullPath = buildFullPath(config.baseURL, config.url, config.allowAbsoluteUrls, config);
    return buildURL(fullPath, config.params, config.paramsSerializer);
  }
};
utils_default.forEach(["delete", "get", "head", "options"], function forEachMethodNoData(method) {
  Axios.prototype[method] = function(url2, config) {
    return this.request(
      mergeConfig(config || {}, {
        method,
        url: url2,
        data: config && utils_default.hasOwnProp(config, "data") ? config.data : void 0
      })
    );
  };
});
utils_default.forEach(["post", "put", "patch", "query"], function forEachMethodWithData(method) {
  function generateHTTPMethod(isForm) {
    return function httpMethod(url2, data, config) {
      return this.request(
        mergeConfig(config || {}, {
          method,
          headers: isForm ? {
            "Content-Type": "multipart/form-data"
          } : {},
          url: url2,
          data
        })
      );
    };
  }
  Axios.prototype[method] = generateHTTPMethod();
  if (method !== "query") {
    Axios.prototype[method + "Form"] = generateHTTPMethod(true);
  }
});
var Axios_default = Axios;

// node_modules/axios/lib/cancel/CancelToken.js
var CancelToken = class _CancelToken {
  constructor(executor) {
    if (typeof executor !== "function") {
      throw new TypeError("executor must be a function.");
    }
    let resolvePromise;
    this.promise = new Promise(function promiseExecutor(resolve) {
      resolvePromise = resolve;
    });
    const token = this;
    this.promise.then((cancel) => {
      if (!token._listeners) return;
      let i = token._listeners.length;
      while (i-- > 0) {
        token._listeners[i](cancel);
      }
      token._listeners = null;
    });
    this.promise.then = (onfulfilled) => {
      let _resolve;
      const promise = new Promise((resolve) => {
        token.subscribe(resolve);
        _resolve = resolve;
      }).then(onfulfilled);
      promise.cancel = function reject() {
        token.unsubscribe(_resolve);
      };
      return promise;
    };
    executor(function cancel(message, config, request) {
      if (token.reason) {
        return;
      }
      token.reason = new CanceledError_default(message, config, request);
      resolvePromise(token.reason);
    });
  }
  /**
   * Throws a `CanceledError` if cancellation has been requested.
   */
  throwIfRequested() {
    if (this.reason) {
      throw this.reason;
    }
  }
  /**
   * Subscribe to the cancel signal
   */
  subscribe(listener) {
    if (this.reason) {
      listener(this.reason);
      return;
    }
    if (this._listeners) {
      this._listeners.push(listener);
    } else {
      this._listeners = [listener];
    }
  }
  /**
   * Unsubscribe from the cancel signal
   */
  unsubscribe(listener) {
    if (!this._listeners) {
      return;
    }
    const index = this._listeners.indexOf(listener);
    if (index !== -1) {
      this._listeners.splice(index, 1);
    }
  }
  toAbortSignal() {
    const controller = new AbortController();
    const abort = (err) => {
      controller.abort(err);
    };
    this.subscribe(abort);
    controller.signal.unsubscribe = () => this.unsubscribe(abort);
    return controller.signal;
  }
  /**
   * Returns an object that contains a new `CancelToken` and a function that, when called,
   * cancels the `CancelToken`.
   */
  static source() {
    let cancel;
    const token = new _CancelToken(function executor(c) {
      cancel = c;
    });
    return {
      token,
      cancel
    };
  }
};
var CancelToken_default = CancelToken;

// node_modules/axios/lib/helpers/spread.js
function spread(callback) {
  return function wrap(arr) {
    return callback.apply(null, arr);
  };
}

// node_modules/axios/lib/helpers/isAxiosError.js
function isAxiosError(payload) {
  return utils_default.isObject(payload) && payload.isAxiosError === true;
}

// node_modules/axios/lib/helpers/HttpStatusCode.js
var HttpStatusCode = {
  Continue: 100,
  SwitchingProtocols: 101,
  Processing: 102,
  EarlyHints: 103,
  Ok: 200,
  Created: 201,
  Accepted: 202,
  NonAuthoritativeInformation: 203,
  NoContent: 204,
  ResetContent: 205,
  PartialContent: 206,
  MultiStatus: 207,
  AlreadyReported: 208,
  ImUsed: 226,
  MultipleChoices: 300,
  MovedPermanently: 301,
  Found: 302,
  SeeOther: 303,
  NotModified: 304,
  UseProxy: 305,
  Unused: 306,
  TemporaryRedirect: 307,
  PermanentRedirect: 308,
  BadRequest: 400,
  Unauthorized: 401,
  PaymentRequired: 402,
  Forbidden: 403,
  NotFound: 404,
  MethodNotAllowed: 405,
  NotAcceptable: 406,
  ProxyAuthenticationRequired: 407,
  RequestTimeout: 408,
  Conflict: 409,
  Gone: 410,
  LengthRequired: 411,
  PreconditionFailed: 412,
  PayloadTooLarge: 413,
  UriTooLong: 414,
  UnsupportedMediaType: 415,
  RangeNotSatisfiable: 416,
  ExpectationFailed: 417,
  ImATeapot: 418,
  MisdirectedRequest: 421,
  UnprocessableEntity: 422,
  Locked: 423,
  FailedDependency: 424,
  TooEarly: 425,
  UpgradeRequired: 426,
  PreconditionRequired: 428,
  TooManyRequests: 429,
  RequestHeaderFieldsTooLarge: 431,
  UnavailableForLegalReasons: 451,
  InternalServerError: 500,
  NotImplemented: 501,
  BadGateway: 502,
  ServiceUnavailable: 503,
  GatewayTimeout: 504,
  HttpVersionNotSupported: 505,
  VariantAlsoNegotiates: 506,
  InsufficientStorage: 507,
  LoopDetected: 508,
  NotExtended: 510,
  NetworkAuthenticationRequired: 511,
  WebServerIsDown: 521,
  ConnectionTimedOut: 522,
  OriginIsUnreachable: 523,
  TimeoutOccurred: 524,
  SslHandshakeFailed: 525,
  InvalidSslCertificate: 526
};
Object.entries(HttpStatusCode).forEach(([key, value]) => {
  HttpStatusCode[value] = key;
});
var HttpStatusCode_default = HttpStatusCode;

// node_modules/axios/lib/axios.js
function createInstance(defaultConfig) {
  const context = new Axios_default(defaultConfig);
  const instance = bind(Axios_default.prototype.request, context);
  utils_default.extend(instance, Axios_default.prototype, context, { allOwnKeys: true });
  utils_default.extend(instance, context, null, { allOwnKeys: true });
  instance.create = function create2(instanceConfig) {
    return createInstance(mergeConfig(defaultConfig, instanceConfig));
  };
  return instance;
}
var axios = createInstance(defaults_default);
axios.Axios = Axios_default;
axios.CanceledError = CanceledError_default;
axios.CancelToken = CancelToken_default;
axios.isCancel = isCancel;
axios.VERSION = VERSION;
axios.toFormData = toFormData_default;
axios.AxiosError = AxiosError_default;
axios.Cancel = axios.CanceledError;
axios.all = function all(promises) {
  return Promise.all(promises);
};
axios.spread = spread;
axios.isAxiosError = isAxiosError;
axios.mergeConfig = mergeConfig;
axios.AxiosHeaders = AxiosHeaders_default;
axios.formToJSON = (thing) => formDataToJSON_default(utils_default.isHTMLForm(thing) ? new FormData(thing) : thing);
axios.getAdapter = adapters_default.getAdapter;
axios.HttpStatusCode = HttpStatusCode_default;
axios.default = axios;
var axios_default = axios;

// node_modules/axios/index.js
var {
  Axios: Axios2,
  AxiosError: AxiosError2,
  CanceledError: CanceledError2,
  isCancel: isCancel2,
  CancelToken: CancelToken2,
  VERSION: VERSION2,
  all: all2,
  Cancel,
  isAxiosError: isAxiosError2,
  spread: spread2,
  toFormData: toFormData2,
  AxiosHeaders: AxiosHeaders2,
  HttpStatusCode: HttpStatusCode2,
  formToJSON,
  getAdapter: getAdapter2,
  mergeConfig: mergeConfig2,
  create
} = axios_default;

// src/shared/api/client.ts
var API_BASE_URL = "http://sis.test/api/v1";
var accessToken = null;
function setAccessToken(token) {
  accessToken = token;
}
var onRefreshFailure = null;
var ApiError = class extends Error {
  status;
  code;
  fields;
  requestId;
  constructor(status, body, fallback) {
    super(body?.message ?? fallback);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code ?? "unknown_error";
    if (body?.fields) this.fields = body.fields;
    if (body?.request_id) this.requestId = body.request_id;
  }
};
function toApiError(error) {
  if (error instanceof AxiosError2) {
    const status = error.response?.status ?? 0;
    const body = error.response?.data?.error;
    return new ApiError(status, body, error.message || "Request failed");
  }
  return new ApiError(0, void 0, error instanceof Error ? error.message : "Network error");
}
var api = axios_default.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" }
});
var rawClient = axios_default.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" }
});
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return config;
});
var refreshPromise = null;
function performRefresh() {
  if (!refreshPromise) {
    refreshPromise = rawClient.post("/auth/refresh", null, {
      headers: { "X-Refresh": "1" }
    }).then((res) => {
      const token = res.data.access_token;
      setAccessToken(token);
      return token;
    }).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (!(error instanceof AxiosError2) || !error.response) {
      return Promise.reject(toApiError(error));
    }
    const status = error.response.status;
    const original = error.config;
    const isRefreshCall = original?.url?.includes("/auth/refresh");
    if (status === 401 && original && !original._retried && !isRefreshCall) {
      original._retried = true;
      try {
        const newToken = await performRefresh();
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api.request(original);
      } catch (refreshErr) {
        setAccessToken(null);
        onRefreshFailure?.();
        return Promise.reject(toApiError(refreshErr));
      }
    }
    return Promise.reject(toApiError(error));
  }
);

// src/shared/api/mocks/demo/bajcCatalog.ts
var BAJC_COURSES = [
  ["ACCT1102", "Principles of Accounting 1", 3, "CEC", null],
  ["ACCT1214", "Principles of Accounting 2", 3, "CEC", "ACCT1102"],
  ["AGRI1102", "Plant Physiology & Morphology", 3, "GEC", null],
  ["AGRI1108", "Crop Production 1", 3, "CEC", "AGRI1122"],
  ["AGRI1109", "Livestock Production 1", 3, "CEC", "AGRI1120"],
  ["AGRI1120", "Principles of Livestock Production", 3, "CEC", null],
  ["AGRI1122", "Principles of Crop Production", 3, "CEC", null],
  ["AGRI1212", "Fundamentals of Soil", 3, "CEC", null],
  ["AGRI2110", "Crop Production 2", 3, "CEC", "AGRI1108"],
  ["AGRI2114", "Livestock Nutrition", 3, "CEC", "AGRI1109"],
  ["AGRI2116", "Livestock Production 2", 3, "CEC", "AGRI1109"],
  ["AGRI2118", "Agriculture Field Experience", 6, "CEC", "AGRI1108, AGRI1109"],
  ["AGRI2222", "Value Added Products", 3, "CEC", "AGRI2118"],
  ["AGRI2224", "Applied Agro-Forestry", 3, "CEC", "AGRI2118"],
  ["BFIN1208", "Business Finance", 3, "CEC", null],
  ["BIOL1102", "Foundations of Biology", 3, "CEC", null],
  ["BIOL1102L", "Foundations of Biology Lab", 1, "CEC", null],
  ["BIOL1204", "Reproduction Growth & Development", 3, "CEC", "BIOL1102"],
  ["BIOL1204L", "Reproduction Growth & Development Lab", 1, "CEC", "BIOL1102L"],
  ["BIOL1212", "Genetics & Creation", 3, "CEC", "BIOL1102"],
  ["BIOL1212L", "Genetics & Creation Lab", 1, "CEC", "BIOL1102L"],
  ["BIOL2101", "Cytology", 3, "CEC", "BIOL1102"],
  ["BIOL2101L", "Cytology Lab", 1, "CEC", "BIOL1102L"],
  ["BIOL2114", "Human Anatomy & Physiology 1", 3, "CEC", "BIOL1204"],
  ["BIOL2114L", "Human Anatomy & Physiology 1 Lab", 1, "CEC", "BIOL1204L"],
  ["BIOL2216", "Human Anatomy & Physiology 2", 3, "CEC", "BIOL2114"],
  ["BIOL2216L", "Human Anatomy & Physiology 2 Lab", 1, "CEC", "BIOL2114L"],
  ["BIOL2220", "Ecology", 3, "CEC", null],
  ["BIOL2220L", "Ecology Lab", 1, "CEC", null],
  ["BIOL2222", "Biodiversity", 3, "CEC", "CHEM2110"],
  ["BIOL2222L", "Biodiversity Lab", 1, "CEC", "CHEM2110L"],
  ["BUSS1210", "Marketing", 3, "CEC", "MGMT1106"],
  ["BUSS2116", "Business Law", 3, "CEC", null],
  ["BUSS2122", "Small Business Management", 3, "CEC", "BUSS1210"],
  ["BUSS2124", "Business Ethics", 3, "CEC", null],
  ["BUSS2224", "Business English", 3, "CEC", "ENGL1204"],
  ["BUST1104", "Business Statistics", 3, "CEC", "MATH1110"],
  ["CHEM1100", "Fundamentals of Chemistry", 3, "CEC", null],
  ["CHEM1100L", "Fundamentals of Chemistry Lab", 1, "CEC", null],
  ["CHEM2110", "Organic Chemistry & Biochemistry", 3, "CEC", "CHEM1100"],
  ["CHEM2110L", "Organic Chemistry & Biochemistry Lab", 1, "CEC", "CHEM1100L"],
  ["CRTH1010", "Critical Thinking", 3, "GEC", null],
  ["ECON1212", "Principles of Microeconomics", 3, "CEC", null],
  ["ECON2118", "Principles of Macroeconomics", 3, "CEC", null],
  ["EDUC1102", "Nature of the Learner", 4, "CEC", null],
  ["EDUC1104", "Introduction to Education", 3, "SEC", null],
  ["EDUC1208", "College Math for Prim. Sch. Trs. 1", 3, "CEC", null],
  ["EDUC1210", "Teaching Mtd. for Primary Curriculum", 4, "CEC", "EDUC1102, EDUC1104"],
  ["EDUC1212", "Science Content for Primary School", 3, "CEC", null],
  ["EDUC1214", "Social Studies Content", 3, "CEC", "EDUC1210"],
  ["EDUC2110", "Music Education & Instrument", 3, "CEC", null],
  ["EDUC2116", "Health & Family Life Education", 3, "CEC", "EDUC1210"],
  ["EDUC2118", "Phys. Educ. for the Prim. Curriculum", 3, "CEC", "EDUC1210"],
  ["EDUC2222", "College Math for Prim. School. Trs 2", 3, "CEC", "EDUC1208"],
  ["EDUC2224", "Fundamentals of Linguistics", 3, "CEC", null],
  ["EDUC2226", "Managing the Regular & Multigrade Class", 3, "CEC", "EDUC1210"],
  ["EDUC2228", "Language Arts Mtds for the Prim. Class 1", 3, "CEC", "EDUC1210"],
  ["EDUC2305", "Teaching Practicum", 3, "CEC", "EDUC1210, 2226, 2228, 2330, 2334, 2336"],
  ["EDUC2330", "Social Studies Mtds. for the Prim. Class", 3, "CEC", "EDUC1210"],
  ["EDUC2332", "Lang. Arts Mtds. for the Prim. Class 2", 3, "CEC", "EDUC2228"],
  ["EDUC2334", "Math Conc. & Mtds. for the Prim. Grade", 4, "CEC", "EDUC1210"],
  ["EDUC2336", "Science Conc. & Mtds for the Prim. Grades", 3, "CEC", "EDUC1210"],
  ["EDUC3101", "Spanish Mtds for the Prim. Classroom", 3, "CEC", "EDUC1210, SPAN2112"],
  ["EDUC3201", "Internship", 9, "CEC", "ALL COURSES"],
  ["ENGL1102", "College English 1", 3, "SEC", null],
  ["ENGL1103", "Research Methods", 3, "SEC", null],
  ["ENGL1106", "Fundamentals of English", 3, "SEC", null],
  ["ENGL1204", "College English 2", 3, "SEC", "ENGL1102"],
  ["ENGL2105", "Language & Communication", 3, "SEC", null],
  ["HIST2102", "Belizean History", 3, "GEC", null],
  ["ITEC1104", "Introduction to Computers", 3, "GEC", null],
  ["ITEC1108", "Introduction to Computing", 3, "CEC", null],
  ["ITEC1110", "Principles of Programming 1", 3, "CEC", null],
  ["ITEC1202", "Principles of Programming 2", 3, "CEC", "ITEC1110"],
  ["ITEC1206", "Web Development", 3, "CEC", "ITEC1108"],
  ["ITEC1208", "Object Oriented Programming", 3, "CEC", "ITEC1108"],
  ["ITEC1214", "Basic PC Repair", 3, "CEC", null],
  ["ITEC2111", "Database Design and Implementation", 3, "CEC", null],
  ["ITEC2116", "Data Structures", 3, "CEC", null],
  ["ITEC2118", "Systems Analysis", 3, "CEC", null],
  ["ITEC2210", "Computer Application for Administrators", 3, "CEC", "ITEC1104"],
  ["ITEC2212", "Networking 1", 3, "CEC", null],
  ["ITEC2222", "Graphical User Interface Programming", 3, "CEC", "ITEC1208"],
  ["ITEC2224", "Operating Systems Analysis", 3, "CEC", null],
  ["MATH1103", "Plane Geometry", 3, "CEC", null],
  ["MATH1104", "Trigonometry", 3, "CEC", null],
  ["MATH1110", "Intermediate Algebra", 3, "SEC", null],
  ["MATH1206", "Calculus 1", 3, "CEC", "MATH1210"],
  ["MATH1208", "Statistics 1", 3, "CEC", "MATH1110"],
  ["MATH1210", "Pre-Calculus", 3, "SEC", "MATH1110"],
  ["MATH2110", "Calculus 2", 3, "CEC", "MATH1206"],
  ["MATH2214", "Statistics 2", 3, "CEC", "MATH1208"],
  ["MATH2216", "Counting, Matrices & Complex Numbers", 3, "CEC", "MATH1110"],
  ["MGMT1106", "Business Management", 3, "SEC", null],
  ["PHIL1110", "Ethics", 3, "SEC", null],
  ["PHIL2211", "Philosophy of Education", 3, "GEC", null],
  ["PSYC2108", "Introduction to Psychology", 3, "SEC", null],
  ["SOCI1212", "Introduction to Sociology", 3, "SEC", null],
  ["SOWK2201", "Introduction to Social Work & Community Resource", 3, "CEC", null],
  ["SPAN2112", "Intermediate Spanish", 3, "GEC", null],
  ["THEO1104", "Personal Evangelism", 2, "CEC", null],
  ["THEO1108", "Daniel", 3, "CEC", null],
  ["THEO1110", "Life & Teaching of Jesus", 3, "GEC", null],
  ["THEO1110-B", "Science & Religion", 3, "CEC", null],
  ["THEO1210", "Christian Beliefs", 3, "GEC", null],
  ["THEO1212", "Revelation", 3, "CEC", null],
  ["THEO1218", "SDA Church History & Prophetic Orientation", 3, "CEC", null],
  ["THEO2114", "Homiletics 1", 2, "CEC", null],
  ["THEO2118", "Propaedeutic & Hermeneutics", 3, "CEC", null],
  ["THEO2201", "Health Principles", 3, "GEC", null],
  ["THEO2210", "Public Evangelism", 2, "CEC", null],
  ["THEO2224", "Practicum", 3, "CEC", "THEO1104, THEO2114"],
  ["THEO2226", "Church Administration", 3, "CEC", null],
  ["THEO2228", "Homiletics 2", 2, "CEC", "THEO2114"]
];
var BAJC_PROGRAMS = [
  ["BMAD", "Business Management", "Associate of Social Science", 87, "2.50"],
  ["GNST", "General Studies", "Associate of Social Science", 87, "2.50"],
  ["BIOL", "Biology", "Associate of Science", 88, "2.50"],
  ["AGRI", "Applied Agriculture", "Associate of Science", 86, "2.50"],
  ["ITEC", "Information Technology", "Associate of Science", 90, "2.50"],
  ["MATH", "Mathematics", "Associate of Science", 87, "2.50"],
  ["EDUC", "Primary Education", "Associate of Arts", 102, "2.00"],
  ["RELG", "Religion", "Associate of Arts", 86, "2.50"]
];
var BAJC_CURRICULUM = [
  ["BMAD", "Summer 1", 1, ["CRTH1010", "ITEC1104"]],
  ["BMAD", "Semester 1", 2, ["ACCT1102", "ENGL1102", "ENGL2105", "MATH1110", "MGMT1106", "THEO1110", "THEO2201"]],
  ["BMAD", "Semester 2", 3, ["ACCT1214", "BUSS1210", "ECON1212", "ENGL1204", "MATH1210", "THEO1210"]],
  ["BMAD", "Semester 3", 4, ["BUSS2116", "BUSS2124", "BUST1104", "ECON2118", "ENGL1103", "HIST2102", "PSYC2108"]],
  ["BMAD", "Semester 4", 5, ["BFIN1208", "BUSS2122", "BUSS2224", "ITEC2210", "PHIL1110", "PHIL2211", "SPAN2112"]],
  ["GNST", "Summer 1", 1, ["CRTH1010", "ITEC1104"]],
  ["GNST", "Semester 1", 2, ["EDUC1104", "ENGL1102", "ENGL2105", "MATH1110", "MGMT1106", "PSYC2108", "THEO1110"]],
  ["GNST", "Semester 2", 3, ["ECON1212", "ENGL1204", "MATH1210", "PHIL1110", "SOCI1212", "THEO1210"]],
  ["GNST", "Semester 3", 4, ["ACCT1102", "BUSS2124", "BUST1104", "EDUC2110", "ENGL1103", "HIST2102", "THEO2201"]],
  ["GNST", "Semester 4", 5, ["BUSS1210", "BUSS2224", "EDUC2224", "ITEC2210", "PHIL2211", "SOWK2201", "SPAN2112"]],
  ["BIOL", "Summer 1", 1, ["CRTH1010", "ITEC1104"]],
  ["BIOL", "Semester 1", 2, ["BIOL1102", "BIOL1102L", "CHEM1100", "CHEM1100L", "ENGL1102", "MATH1110", "MGMT1106", "THEO1110"]],
  ["BIOL", "Semester 2", 3, ["AGRI1102", "BIOL1204", "BIOL1204L", "BIOL1212", "BIOL1212L", "ENGL1204", "PHIL1110", "THEO1210"]],
  ["BIOL", "Semester 3", 4, ["BIOL2101", "BIOL2101L", "BIOL2114", "BIOL2114L", "CHEM2110", "CHEM2110L", "ENGL1103", "HIST2102", "PSYC2108"]],
  ["BIOL", "Semester 4", 5, ["BIOL2216", "BIOL2216L", "BIOL2220", "BIOL2220L", "BIOL2222", "BIOL2222L", "PHIL2211", "SOCI1212", "SPAN2112"]],
  ["AGRI", "Summer 1", 1, ["CRTH1010", "ITEC1104"]],
  ["AGRI", "Semester 1", 2, ["AGRI1120", "AGRI1122", "CHEM1100", "CHEM1100L", "ENGL1102", "MATH1110", "THEO1110"]],
  ["AGRI", "Semester 2", 3, ["AGRI1102", "AGRI1108", "AGRI1109", "AGRI1212", "ECON1212", "ENGL1204", "THEO1210"]],
  ["AGRI", "Semester 3", 4, ["AGRI2110", "AGRI2114", "AGRI2116", "AGRI2118", "ENGL1103", "PSYC2108"]],
  ["AGRI", "Semester 4", 5, ["AGRI2222", "AGRI2224", "BIOL2220", "BIOL2220L", "PHIL1110", "PHIL2211", "SPAN2112"]],
  ["ITEC", "Summer 1", 1, ["CRTH1010", "ITEC1104"]],
  ["ITEC", "Semester 1", 2, ["ENGL1102", "ITEC1108", "ITEC1110", "ITEC1214", "MATH1104", "MATH1110", "THEO1110"]],
  ["ITEC", "Semester 2", 3, ["ENGL1204", "ITEC1202", "ITEC1206", "ITEC2111", "MATH1210", "SOCI1212", "THEO1210"]],
  ["ITEC", "Semester 3", 4, ["ENGL1103", "HIST2102", "ITEC1208", "ITEC2116", "ITEC2118", "MATH1206", "MGMT1106"]],
  ["ITEC", "Semester 4", 5, ["ITEC2212", "ITEC2222", "ITEC2224", "MATH2110", "PHIL1110", "PHIL2211", "SPAN2112"]],
  ["MATH", "Summer 1", 1, ["CRTH1010", "ITEC1104"]],
  ["MATH", "Semester 1", 2, ["ENGL1102", "HIST2102", "ITEC1110", "MATH1103", "MATH1104", "MATH1110", "THEO1110"]],
  ["MATH", "Semester 2", 3, ["ECON1212", "ENGL1204", "ITEC1202", "MATH1210", "PHIL1110", "THEO1210"]],
  ["MATH", "Semester 3", 4, ["ENGL1103", "ENGL2105", "MATH1206", "MATH1208", "MGMT1106", "PSYC2108", "THEO2201"]],
  ["MATH", "Semester 4", 5, ["EDUC1104", "MATH2110", "MATH2214", "MATH2216", "PHIL2211", "SOCI1212", "SPAN2112"]],
  ["EDUC", "Summer 1", 1, ["CRTH1010", "ITEC1104"]],
  ["EDUC", "Semester 1", 2, ["EDUC1102", "EDUC1104", "ENGL1106", "HIST2102", "MGMT1106", "THEO1110"]],
  ["EDUC", "Semester 2", 3, ["EDUC1208", "EDUC1210", "EDUC1212", "EDUC1214", "PHIL2211", "THEO1210"]],
  ["EDUC", "Spring 1", 4, ["EDUC2116", "EDUC2118"]],
  ["EDUC", "Semester 3", 5, ["EDUC2110", "EDUC2222", "EDUC2226", "EDUC2330", "EDUC2336", "ENGL1102"]],
  ["EDUC", "Semester 4", 6, ["EDUC2224", "EDUC2228", "EDUC2305", "EDUC2334", "ENGL1204", "SPAN2112"]],
  ["EDUC", "Spring 2", 7, ["EDUC2332", "EDUC3101"]],
  ["EDUC", "Semester 5", 8, ["EDUC3201"]],
  ["RELG", "Summer 1", 1, ["CRTH1010", "ITEC1104"]],
  ["RELG", "Semester 1", 2, ["ACCT1102", "ENGL1102", "ENGL2105", "HIST2102", "THEO1104", "THEO1110", "THEO1110-B"]],
  ["RELG", "Semester 2", 3, ["AGRI1102", "ENGL1204", "SOCI1212", "THEO1108", "THEO1210", "THEO1212", "THEO1218"]],
  ["RELG", "Semester 3", 4, ["EDUC1104", "EDUC2110", "ENGL1103", "PSYC2108", "THEO2114", "THEO2118", "THEO2201"]],
  ["RELG", "Semester 4", 5, ["PHIL1110", "PHIL2211", "SPAN2112", "THEO2210", "THEO2224", "THEO2226", "THEO2228"]]
];
var BAJC_PREREQUISITES = [
  ["ACCT1214", "ACCT1102"],
  ["AGRI1108", "AGRI1122"],
  ["AGRI1109", "AGRI1120"],
  ["AGRI2110", "AGRI1108"],
  ["AGRI2114", "AGRI1109"],
  ["AGRI2116", "AGRI1109"],
  ["AGRI2118", "AGRI1108"],
  ["AGRI2118", "AGRI1109"],
  ["AGRI2222", "AGRI2118"],
  ["AGRI2224", "AGRI2118"],
  ["BIOL1204", "BIOL1102"],
  ["BIOL1204L", "BIOL1102L"],
  ["BIOL1212", "BIOL1102"],
  ["BIOL1212L", "BIOL1102L"],
  ["BIOL2101", "BIOL1102"],
  ["BIOL2101L", "BIOL1102L"],
  ["BIOL2114", "BIOL1204"],
  ["BIOL2114L", "BIOL1204L"],
  ["BIOL2216", "BIOL2114"],
  ["BIOL2216L", "BIOL2114L"],
  ["BIOL2222", "CHEM2110"],
  ["BIOL2222L", "CHEM2110L"],
  ["BUSS1210", "MGMT1106"],
  ["BUSS2122", "BUSS1210"],
  ["BUSS2224", "ENGL1204"],
  ["BUST1104", "MATH1110"],
  ["CHEM2110", "CHEM1100"],
  ["CHEM2110L", "CHEM1100L"],
  ["EDUC1210", "EDUC1102"],
  ["EDUC1210", "EDUC1104"],
  ["EDUC1214", "EDUC1210"],
  ["EDUC2116", "EDUC1210"],
  ["EDUC2118", "EDUC1210"],
  ["EDUC2222", "EDUC1208"],
  ["EDUC2226", "EDUC1210"],
  ["EDUC2228", "EDUC1210"],
  ["EDUC2305", "EDUC1210"],
  ["EDUC2305", "EDUC2226"],
  ["EDUC2305", "EDUC2228"],
  ["EDUC2305", "EDUC2330"],
  ["EDUC2305", "EDUC2334"],
  ["EDUC2305", "EDUC2336"],
  ["EDUC2330", "EDUC1210"],
  ["EDUC2332", "EDUC2228"],
  ["EDUC2334", "EDUC1210"],
  ["EDUC2336", "EDUC1210"],
  ["EDUC3101", "EDUC1210"],
  ["EDUC3101", "SPAN2112"],
  ["ENGL1204", "ENGL1102"],
  ["ITEC1202", "ITEC1110"],
  ["ITEC1206", "ITEC1108"],
  ["ITEC1208", "ITEC1108"],
  ["ITEC2210", "ITEC1104"],
  ["ITEC2222", "ITEC1208"],
  ["MATH1206", "MATH1210"],
  ["MATH1208", "MATH1110"],
  ["MATH1210", "MATH1110"],
  ["MATH2110", "MATH1206"],
  ["MATH2214", "MATH1208"],
  ["MATH2216", "MATH1110"],
  ["THEO2224", "THEO1104"],
  ["THEO2224", "THEO2114"],
  ["THEO2228", "THEO2114"]
];
var BAJC_ALL_COURSE_GATES = [
  ["EDUC3201", "EDUC"]
];

// src/shared/api/mocks/demo/data.ts
var DEMO_TODAY = "2025-10-15";
var DEMO_TODAY_ISO = "2025-10-15T09:00:00Z";
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}
function addDays(iso, days) {
  const d = /* @__PURE__ */ new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function isWeekday(iso) {
  const day = (/* @__PURE__ */ new Date(`${iso}T00:00:00Z`)).getUTCDay();
  return day >= 1 && day <= 5;
}
var school_profile = {
  name: "Belize Adventist Junior College",
  address: "Corozal Town, Corozal District, Belize",
  phone: "+501-422-2015",
  email: "office@bajc.edu.bz",
  logo_url: "/logo.jpeg",
  // D39 (Meeting #2 item 6) — the client's recommended three months.
  post_graduation_access_days: 90,
  // Brand colors sampled from the BAJC seal (navy triangle + crimson ring).
  colors: { primary: "#1E3A6E", secondary: "#C21F30" }
};
var YEAR_ARCHIVED = "ay-2024";
var YEAR_ACTIVE = "ay-2025";
var SEM_ACTIVE = "sem-2025-1";
var SEM_2025_2 = "sem-2025-2";
var academic_years = [
  {
    id: YEAR_ARCHIVED,
    name: "2024-2025",
    start_date: "2024-09-02",
    end_date: "2025-06-27",
    status: "archived",
    archived_at: "2025-07-15T12:00:00Z"
  },
  {
    id: YEAR_ACTIVE,
    name: "2025-2026",
    start_date: "2025-09-01",
    end_date: "2026-06-26",
    status: "active",
    archived_at: null
  }
];
var semesters = [
  {
    id: "sem-2024-1",
    academic_year_id: YEAR_ARCHIVED,
    name: "Semester 1",
    term_type: "semester",
    sequence: 1,
    start_date: "2024-09-02",
    end_date: "2025-01-17",
    grade_submission_deadline: null,
    midterm_submission_start: null,
    midterm_submission_end: null,
    is_active: false
  },
  {
    id: "sem-2024-2",
    academic_year_id: YEAR_ARCHIVED,
    name: "Semester 2",
    term_type: "semester",
    sequence: 2,
    start_date: "2025-01-20",
    end_date: "2025-06-27",
    grade_submission_deadline: null,
    midterm_submission_start: null,
    midterm_submission_end: null,
    is_active: false
  },
  {
    id: SEM_ACTIVE,
    academic_year_id: YEAR_ACTIVE,
    name: "Semester 1",
    term_type: "semester",
    sequence: 1,
    start_date: "2025-09-01",
    end_date: "2026-01-16",
    // D30 §D6 — a deadline in the FUTURE relative to DEMO_TODAY (2025-10-15). Deliberate:
    // it makes the feature visible (Settings shows "Grades due", the term editor shows the
    // field) WITHOUT locking the marquee gradebook, which a past deadline would turn
    // read-only for the whole demo. To see the closed state, move this date behind
    // DEMO_TODAY from Settings → Academic structure and reopen the gradebook — the banner
    // appears and the save bar disables, exactly as the backend behaves.
    grade_submission_deadline: "2026-01-23T23:59:00Z",
    // D32 - a mid-term window that has already CLOSED relative to DEMO_TODAY
    // (2025-10-15). The opposite choice from the end-term deadline above, and for the
    // same reason: this is what makes the feature visible. A window still open would
    // hide the Revision column entirely and the demo would show nothing.
    //
    // With these dates, assessments dated before 2025-09-20 are revisable and anything
    // after 2025-10-10 is not - so the marquee gradebook shows BOTH states side by side,
    // which is the whole point of the rule.
    midterm_submission_start: "2025-09-20T00:00:00Z",
    midterm_submission_end: "2025-10-10T23:59:00Z",
    is_active: true
  },
  {
    id: "sem-2025-2",
    academic_year_id: YEAR_ACTIVE,
    name: "Semester 2",
    term_type: "semester",
    sequence: 2,
    start_date: "2026-01-19",
    end_date: "2026-06-26",
    grade_submission_deadline: "2026-07-03T23:59:00Z",
    midterm_submission_start: null,
    midterm_submission_end: null,
    is_active: false
  }
];
var courses = BAJC_COURSES.map(([code, name, credits, component]) => ({
  id: `course-${code.toLowerCase()}`,
  name,
  code,
  credits,
  component,
  is_active: true
}));
var courseId = (code) => `course-${code.toLowerCase()}`;
var courseName = (code) => {
  const found = BAJC_COURSES.find(([c]) => c === code);
  if (!found) throw new Error(`demo dataset: no BAJC course with code ${code}`);
  return found[1];
};
var offeringSeed = [
  // ── Semester 1 of the active year ──
  {
    key: "MATH1110-01",
    code: "MATH1110",
    sectionCode: "01",
    room: "Room A",
    capacity: 20,
    meetings: [[1, "08:00", "09:30"], [3, "08:00", "09:30"]]
  },
  // -02 is -01's parallel section: same course, same term, different lecturer/room/time.
  // The lecturer is NAMED, not derived: `teacherByCode` returns the first active specialist,
  // and for either MATH code that is Maria Reyes — who already leads -01. Deriving it
  // produced a "parallel section" taught by the same person an hour later, which is exactly
  // the claim this row exists to make true.
  {
    key: "MATH1110-02",
    code: "MATH1110",
    sectionCode: "02",
    teacherNames: ["Marlon Pou"],
    room: "Room C",
    capacity: 20,
    meetings: [[1, "10:00", "11:30"], [3, "10:00", "11:30"]]
  },
  // Capacity 26, not 24: every first-year load includes Biology, and the archived year's
  // fallback load adds the graduated/withdrawn students on top, so 24 seated 25. Enrolling
  // over capacity is warn-only (D-Q6) rather than refused, so the old number did not fail —
  // it quietly seeded a college that breaks its own rule on the screen showing the warning.
  {
    key: "BIOL1102-01",
    code: "BIOL1102",
    sectionCode: "01",
    room: "Lab 1",
    capacity: 26,
    meetings: [[2, "09:00", "10:30"], [4, "09:00", "10:30"]]
  },
  // Wednesday sits at 13:00, NOT 11:00: MATH1110-02 runs Wed 10:00–11:30, and every student
  // on that load also takes English, so an 11:00 English would put 15 of them in two rooms
  // at once. The seeded week must be one a real student could actually walk.
  //
  // Capacity 32 for the same reason as Biology, only larger: EVERY one of the 30 first-years
  // takes English, so any capacity below the intake is over-subscribed by construction.
  {
    key: "ENGL1102-01",
    code: "ENGL1102",
    sectionCode: "01",
    room: "Room D",
    capacity: 32,
    meetings: [[3, "13:00", "14:00"], [5, "11:00", "12:00"]]
  },
  {
    key: "CHEM1100-01",
    code: "CHEM1100",
    sectionCode: "01",
    room: "Lab 2",
    capacity: 18,
    meetings: [[2, "11:00", "12:30"]]
  },
  {
    key: "ITEC1104-01",
    code: "ITEC1104",
    sectionCode: "01",
    room: "Computer Lab",
    capacity: 22,
    meetings: [[5, "08:00", "09:30"]]
  },
  // A third section of the same course, for the second-year cohort.
  {
    key: "MATH1110-03",
    code: "MATH1110",
    sectionCode: "03",
    room: "Room A",
    capacity: 18,
    meetings: [[2, "08:00", "09:30"], [4, "11:00", "12:30"]]
  },
  // Gated on Algebra: enrolling a student who has not passed MATH1110 is a 409 naming it.
  {
    key: "MATH1210-01",
    code: "MATH1210",
    sectionCode: "01",
    room: "Room F",
    capacity: 16,
    meetings: [[1, "13:00", "14:30"]]
  },
  {
    key: "MGMT1106-01",
    code: "MGMT1106",
    sectionCode: "01",
    room: "Room B",
    capacity: 20,
    meetings: [[4, "13:00", "14:30"]]
  },
  {
    key: "SPAN2112-01",
    code: "SPAN2112",
    sectionCode: "01",
    room: "Room E",
    capacity: 20,
    meetings: [[5, "13:00", "14:00"]]
  },
  // ── Semester 2 of the active year — THE D31 PROOF ──
  // The same course, the same section code, a DIFFERENT term. Under the old model these
  // would have collided with the rows above (one class row per course per YEAR); here they
  // are distinct offerings with their own rosters, assessments and gradebooks. Capacity is
  // null on both, which exercises the "no limit" branch nothing else covered.
  {
    key: "MATH1110-01@S2",
    code: "MATH1110",
    sectionCode: "01",
    semesterId: SEM_2025_2,
    room: "Room A",
    capacity: null,
    meetings: [[1, "08:00", "09:30"], [3, "08:00", "09:30"]]
  },
  {
    key: "BIOL1102-01@S2",
    code: "BIOL1102",
    sectionCode: "01",
    semesterId: SEM_2025_2,
    room: "Lab 1",
    capacity: null,
    meetings: [[2, "09:00", "10:30"], [4, "09:00", "10:30"]]
  }
];
var SEM2_KEYS = offeringSeed.filter((o) => o.semesterId === SEM_2025_2).map((o) => o.key);
var teacherSeed = [
  ["Maria Reyes", ["MATH1110", "MATH1210"], "active", "female"],
  ["Carlos Mendez", ["ENGL1102", "HIST2102"], "active", "male"],
  ["Alicia Cano", ["BIOL1102", "CHEM1100"], "active", "female"],
  ["Devon Flowers", ["MATH1210", "MATH1110"], "active", "male"],
  ["Sonia Choc", ["SPAN2112", "ENGL1102"], "active", "female"],
  ["Rodwell Bailey", ["SOCI1212", "HIST2102"], "active", "male"],
  ["Yolanda Cruz", ["CHEM1100", "BIOL1102"], "active", "female"],
  ["Egbert Grinage", ["THEO2201"], "active", "male"],
  ["Nadia Rhaburn", ["ITEC1104"], "active", "female"],
  ["Marlon Pou", ["MGMT1106", "MATH1110"], "active", "male"],
  ["Kayla Waight", ["ENGL1102", "ITEC1104"], "active", "female"],
  ["Trevor Neal", ["SOCI1212", "THEO2201"], "inactive", "male"]
];
var TEACHER_DESIGNATIONS = [
  "Head of Department",
  "Senior Lecturer",
  "Senior Lecturer",
  "Lecturer"
];
var TEACHER_DEGREES = {
  "Head of Department": "M.Ed.",
  "Senior Lecturer": "M.Sc.",
  Lecturer: "B.Ed."
};
var BELIZE_STREETS = [
  "Constitution Drive",
  "Forest Drive",
  "Melhado Parade",
  "Bliss Parade",
  "Hummingbird Avenue",
  "Ring Road"
];
var teachers = teacherSeed.map(([full_name, specs, status, gender], i) => {
  const specNames = specs.map((c) => courseName(c));
  const designation = TEACHER_DESIGNATIONS[i % TEACHER_DESIGNATIONS.length];
  const rng = makeRng(900 + i);
  const years = randInt(rng, 5, 22);
  return {
    id: `teach-${i + 1}`,
    user_id: status === "active" ? `user-teach-${i + 1}` : null,
    staff_number: `T-${String(1001 + i)}`,
    full_name,
    email: `${full_name.toLowerCase().replace(/[^a-z]+/g, ".")}@belmopancomp.edu.bz`,
    phone: `+501-6${randInt(makeRng(700 + i), 1e5, 999999)}`,
    subject_specializations: specNames,
    status,
    gender,
    designation,
    academic_qualification: `${TEACHER_DEGREES[designation]} ${specNames[0]}`,
    // D39 — the split names mirror what 013 backfilled in the real database.
    first_name: full_name.split(" ")[0],
    last_name: full_name.split(" ").slice(-1)[0],
    // Only the lead lecturer carries an SS# and a licence, so the demo shows both the
    // populated and the empty rendering of these fields rather than only one.
    ssno: i === 0 ? "000256398" : void 0,
    licensenum: i === 0 ? "OWD-2019-00035" : void 0,
    bio: `${designation} with ${years} years of classroom experience teaching ${specNames[0]}. Committed to student-centred learning and measurable outcomes.`,
    address: `${randInt(rng, 1, 120)} ${pick(rng, BELIZE_STREETS)}, Belmopan, Cayo`,
    // Expertise derived from specializations; the lead subject rates highest.
    expertise: specNames.map((area, idx) => ({
      area,
      level: idx === 0 ? randInt(rng, 82, 95) : randInt(rng, 60, 85)
    }))
  };
});
var teacherByCode = (code) => {
  const name = courseName(code);
  return teachers.find((t) => t.status === "active" && t.subject_specializations.includes(name));
};
var teacherByName = (fullName) => {
  const found = teachers.find((t) => t.status === "active" && t.full_name === fullName);
  if (!found) throw new Error(`demo dataset: no active lecturer named ${fullName}`);
  return found;
};
var offerings = offeringSeed.map((o, i) => {
  const lead = o.teacherNames?.[0] ? teacherByName(o.teacherNames[0]) : teacherByCode(o.code);
  const extra = (o.teacherNames ?? []).slice(1).map((name) => teacherByName(name).id);
  const coTeacher = o.key === "MATH1110-01" ? teachers.find((tt) => tt.id === "teach-4") : void 0;
  const teacher_ids = [
    lead.id,
    ...extra,
    ...coTeacher && coTeacher.id !== lead.id ? [coTeacher.id] : []
  ];
  return {
    id: `off-${i + 1}`,
    course_id: courseId(o.code),
    semester_id: o.semesterId ?? SEM_ACTIVE,
    section_code: o.sectionCode,
    capacity: o.capacity,
    is_archived: false,
    teacher_ids: [...new Set(teacher_ids)],
    lead_teacher_id: lead.id,
    // Drop-lowest on the Algebra offerings, so the D25 fallback is exercised by something.
    // This used to read `c.code === 'MATH'`, which never matched: 'MATH' is a PROGRAMME
    // code, not a course code, so the stored fallback was 0 everywhere and untested.
    drop_lowest_count: o.code === "MATH1110" ? 1 : 0
  };
});
var offeringByKey = (key) => {
  const idx = offeringSeed.findIndex((o) => o.key === key);
  if (idx < 0) throw new Error(`demo dataset: no offering seeded with key ${key}`);
  return offerings[idx];
};
var offering_meetings = [];
var meetingCounter = 0;
offeringSeed.forEach((o, i) => {
  for (const [day, start, end] of o.meetings) {
    meetingCounter += 1;
    offering_meetings.push({
      id: `mtg-${meetingCounter}`,
      offering_id: `off-${i + 1}`,
      day_of_week: day,
      start_time: `${start}:00`,
      end_time: `${end}:00`,
      room: o.room
    });
  }
});
var FIRST_NAMES = [
  "Ana",
  "Luis",
  "Keisha",
  "Jamal",
  "Sofia",
  "Marco",
  "Tanya",
  "Elvin",
  "Rina",
  "Kester",
  "Denise",
  "Andre",
  "Shanice",
  "Oscar",
  "Mila",
  "Trevaughn",
  "Paola",
  "Dwayne",
  "Nayeli",
  "Colin",
  "Britney",
  "Hector",
  "Jaylen",
  "Marisol",
  "Rueben",
  "Alysha",
  "Damian",
  "Cindy",
  "Kevaughn",
  "Leah",
  "Ramon",
  "Whitney",
  "Isaias",
  "Deja",
  "Fernando",
  "Kaylee",
  "Osmond",
  "Yuritzi",
  "Bryce",
  "Amara",
  "Delroy",
  "Selena",
  "Tyrique",
  "Estela",
  "Garrett"
];
var LAST_NAMES = [
  "Lopez",
  "Garcia",
  "Williams",
  "Coye",
  "Martinez",
  "Gongora",
  "Middleton",
  "Requena",
  "Tzul",
  "Flowers",
  "Cacho",
  "Vasquez",
  "Rivera",
  "Perez",
  "Cattouse",
  "Ake",
  "Chan",
  "Ical",
  "Nunez",
  "Palacio"
];
var FIRST_YEAR_LOADS = [
  ["MATH1110-01", "BIOL1102-01", "ENGL1102-01", "CHEM1100-01"],
  ["MATH1110-02", "BIOL1102-01", "ENGL1102-01", "ITEC1104-01"],
  ["MATH1110-01", "BIOL1102-01", "ENGL1102-01", "ITEC1104-01"],
  ["MATH1110-02", "CHEM1100-01", "ENGL1102-01", "ITEC1104-01"]
];
var SECOND_YEAR_LOADS = [
  ["MATH1110-03", "MATH1210-01", "SPAN2112-01"],
  ["MGMT1106-01", "SPAN2112-01", "MATH1110-03"],
  ["MATH1110-03", "MATH1210-01", "MGMT1106-01"]
];
var SCENARIO = {
  "stu-1": {
    name: "Freddy Lopez",
    yearOfStudy: "First",
    offerings: ["MATH1110-01", "BIOL1102-01", "ENGL1102-01", "CHEM1100-01"]
  },
  "stu-2": {
    name: "John Garcia",
    yearOfStudy: "First",
    offerings: ["MATH1110-02", "BIOL1102-01", "ENGL1102-01", "ITEC1104-01"]
  }
};
var DEMO_RELIGIONS = [
  "Catholic",
  "Anglican",
  null,
  "Adventist",
  "Methodist",
  null,
  "Catholic"
];
var religions = [
  { id: 1, name: "Catholic", code_name: "CATH" },
  { id: 2, name: "Seventh Day Adventist", code_name: "SDA" }
];
var DEMO_CIVIL_STATUS = ["Single", "Single", null, "Single", "Married"];
var DEMO_DISTRICTS = [
  "Cayo",
  "Belize",
  "Orange Walk",
  null,
  "Stann Creek",
  "Corozal",
  "Toledo"
];
var DEMO_LOADS = [
  "Full Time",
  "Full Time",
  "Part Time",
  null,
  "Full Time",
  "Transient"
];
var DEMO_NOK_RELATIONSHIPS = ["Mother", "Father", "Aunt", null, "Uncle"];
var students = [];
var rngStu = makeRng(4242);
var loadByStudent = /* @__PURE__ */ new Map();
var cohortSeen = { First: 0, Second: 0 };
for (let i = 0; i < 45; i += 1) {
  const id = `stu-${i + 1}`;
  const scenario = SCENARIO[id];
  const yearOfStudy = scenario?.yearOfStudy ?? (i % 3 === 2 ? "Second" : "First");
  const rotation = cohortSeen[yearOfStudy];
  cohortSeen[yearOfStudy] += 1;
  const first = FIRST_NAMES[i];
  const last = pick(rngStu, LAST_NAMES);
  const birthYear = yearOfStudy === "Second" ? 2007 : 2008;
  const dob = `${birthYear}-${String(randInt(rngStu, 1, 12)).padStart(2, "0")}-${String(
    randInt(rngStu, 1, 28)
  ).padStart(2, "0")}`;
  let status = "Registered";
  if (!scenario) {
    if (i === 7) status = "Unregistered";
    else if (i === 20) status = "withdrawn";
    else if (i === 33) status = "transferred";
    else if (i === 41) status = "graduated";
    else if (i === 28) status = "DropOut";
  }
  const [firstName, ...restName] = (scenario?.name ?? `${first} ${last}`).split(" ");
  const lastName = restName.length ? restName[restName.length - 1] : firstName;
  const middleName = restName.slice(0, -1).join(" ") || null;
  const full_name = [firstName, middleName, lastName].filter(Boolean).join(" ");
  const load = status === "graduated" || status === "withdrawn" ? [] : scenario?.offerings ?? (yearOfStudy === "Second" ? SECOND_YEAR_LOADS[rotation % SECOND_YEAR_LOADS.length] : FIRST_YEAR_LOADS[rotation % FIRST_YEAR_LOADS.length]);
  loadByStudent.set(id, load);
  students.push({
    id,
    user_id: i < 6 ? `user-stu-${i + 1}` : null,
    // first few have logins (demo student login)
    student_number: `S-${String(25001 + i)}`,
    first_name: firstName,
    middle_name: middleName,
    last_name: lastName,
    full_name,
    date_of_birth: dob,
    // D32 fixed a data artefact here. This was `i % 2`, and the programme rotation below
    // is `i % 8` - so every student on a given programme shared an index parity and
    // therefore a GENDER. "Female students in Programme X" returned all of Programme X,
    // which makes the brief's headline combination filter impossible to demonstrate.
    // Adding `floor(i / 8)` breaks the alignment while keeping the overall split even.
    gender: (i + Math.floor(i / BAJC_PROGRAMS.length)) % 2 === 0 ? "female" : "male",
    // D32 (brief §3) - rotated across four denominations plus "not stated", because the
    // filter has to be demonstrable and the live database has this NULL for everyone
    // (only the admissions form collects it, and no application has been processed).
    // The deliberate NULLs matter as much as the values: "All religions" must not
    // silently mean "the ones we happen to know".
    religion: DEMO_RELIGIONS[i % DEMO_RELIGIONS.length],
    enrollment_date: "2025-09-01",
    status,
    year_of_study: yearOfStudy,
    // D30 §D12 — every demo student is registered on a real BAJC programme, rotated
    // deterministically. Primary Education is deliberately in the rotation: it is the
    // one programme that passes at C (2.00) rather than C+ (2.50), so the
    // per-programme pass mark is exercised rather than merely stored.
    program_id: `prog-${BAJC_PROGRAMS[i % BAJC_PROGRAMS.length][0].toLowerCase()}`,
    guardian_name: `${pick(rngStu, FIRST_NAMES)} ${last}`,
    guardian_phone: `+501-6${randInt(rngStu, 1e5, 999999)}`,
    guardian_email: `${last.toLowerCase()}.guardian@example.bz`,
    address: `${randInt(rngStu, 1, 99)} ${pick(rngStu, ["Cedar", "Mahogany", "Bougainvillea", "Hibiscus"])} Street, Belmopan`,
    phone: `+501-6${randInt(rngStu, 1e5, 999999)}`,
    // ── D33: the rest of the admission form ──────────────────────────────────
    // The SSN is null for a third of the register: it is transcribed off a card, and the
    // card is often the document still missing when the student is registered.
    ssno: i % 3 === 1 ? null : `${String(1e8 + i * 7919).slice(0, 9)}`,
    civil_status: DEMO_CIVIL_STATUS[i % DEMO_CIVIL_STATUS.length],
    street: `${randInt(rngStu, 1, 99)} ${pick(rngStu, ["Cedar", "Mahogany", "Bougainvillea", "Hibiscus"])} Street`,
    city_town_village: pick(rngStu, ["Belmopan", "Belize City", "San Ignacio", "Orange Walk Town"]),
    district: DEMO_DISTRICTS[i % DEMO_DISTRICTS.length],
    mother_name: i % 4 === 3 ? null : `${pick(rngStu, FIRST_NAMES)} ${last}`,
    father_name: i % 5 === 4 ? null : `${pick(rngStu, FIRST_NAMES)} ${last}`,
    nok_name: i % 6 === 5 ? null : `${pick(rngStu, FIRST_NAMES)} ${last}`,
    nok_relationship: DEMO_NOK_RELATIONSHIPS[i % DEMO_NOK_RELATIONSHIPS.length],
    nok_phone: i % 6 === 5 ? null : `+501-6${randInt(rngStu, 1e5, 999999)}`,
    // A handful, so the Health section is demonstrable without being the norm.
    has_health_condition: i % 11 === 3,
    health_condition_note: i % 11 === 3 ? "Asthma \u2014 inhaler kept with the school nurse." : null,
    atlib_exam: i % 3 === 0,
    num_csec: i % 7 === 6 ? null : randInt(rngStu, 4, 9),
    finance_name: i % 3 === 2 ? null : `${pick(rngStu, FIRST_NAMES)} ${last}`,
    finance_phone: i % 3 === 2 ? null : `+501-6${randInt(rngStu, 1e5, 999999)}`,
    finance_email: i % 3 === 2 ? null : `${last.toLowerCase()}.finance@example.bz`,
    enrollment_load: DEMO_LOADS[i % DEMO_LOADS.length],
    // ── D34 · the client's own columns ───────────────────────────────────────
    // Sparse on purpose: most are the office's record-keeping about a record, and a
    // dataset where every student had a transfer origin and a drop-out reason would
    // never exercise the profile card's empty-section handling.
    student_id_original: i % 5 === 0 ? 2e4 + i : null,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@student.bajc.edu.bz`,
    transferred_from: status === "transferred" ? "Belize High School" : null,
    graduation_date: status === "graduated" ? "2026-06-19" : null,
    dropout_date: status === "DropOut" ? "2026-03-02T00:00:00Z" : null,
    dropout_reason: status === "DropOut" ? "Relocated abroad mid-semester." : null,
    comments: i % 9 === 4 ? "Fee plan agreed with the bursar." : null,
    origin: i < 6 ? "admissions" : "import-2025",
    // No FK and no consumer — mirrored only so the demo shape matches the wire.
    educationbg_id: null,
    doc_id: null
  });
}
var enrollments = [];
var enrollCounter = 0;
function enrol(studentId, offering, unenrolledAt = null) {
  enrollCounter += 1;
  enrollments.push({
    id: `enr-${enrollCounter}`,
    student_id: studentId,
    offering_id: offering.id,
    semester_id: offering.semester_id,
    enrolled_at: offering.semester_id === SEM_ACTIVE ? "2025-09-01T08:00:00Z" : "2026-01-19T08:00:00Z",
    unenrolled_at: unenrolledAt,
    // D35 — ordinary by default. `seedCourseStatuses()` below marks a few afterwards, so
    // the register has an audit and a withdrawal to show without every row being unusual.
    enrollment_status: "enrolled"
  });
}
for (const stu of students) {
  for (const key of loadByStudent.get(stu.id) ?? []) {
    enrol(stu.id, offeringByKey(key));
  }
}
for (const stu of students) {
  const sem1CourseIds = new Set(
    (loadByStudent.get(stu.id) ?? []).map((key) => offeringByKey(key).course_id)
  );
  for (const key of SEM2_KEYS) {
    const offering = offeringByKey(key);
    if (sem1CourseIds.has(offering.course_id)) enrol(stu.id, offering);
  }
}
var switchStudent = students.find((s) => s.status === "transferred");
if (switchStudent) {
  enrol(switchStudent.id, offeringByKey("MATH1110-01"), "2025-09-25T08:00:00Z");
}
function activeRoster(offeringId) {
  const offering = offerings.find((o) => o.id === offeringId);
  if (!offering) return [];
  const enrolledIds = enrollments.filter(
    (e) => e.offering_id === offeringId && e.semester_id === offering.semester_id && !e.unenrolled_at
  ).map((e) => e.student_id);
  return students.filter((s) => enrolledIds.includes(s.id));
}
function activeEnrollment(studentId, offeringId) {
  return enrollments.find(
    (e) => e.student_id === studentId && e.offering_id === offeringId && !e.unenrolled_at
  );
}
var assessment_categories = [];
for (const off of offerings) {
  assessment_categories.push(
    { id: `cat-${off.id}-q`, offering_id: off.id, name: "Quizzes", weight: 0.4, drop_lowest_count: 1 },
    { id: `cat-${off.id}-t`, offering_id: off.id, name: "Tests", weight: 0.6, drop_lowest_count: 0 }
  );
}
var assessments = [];
var asmtCounter = 0;
var SEM1_ASMT_TEMPLATES = [
  { title: "Quiz 1", type: "quiz", catSuffix: "q", max: 20, weight: 1, offsetDays: -30, status: "graded", released: true },
  { title: "Quiz 2", type: "quiz", catSuffix: "q", max: 20, weight: 1, offsetDays: -16, status: "graded", released: true },
  { title: "Unit Test 1", type: "test", catSuffix: "t", max: 50, weight: 1, offsetDays: -9, status: "graded", released: false },
  { title: "Project", type: "assignment", catSuffix: null, max: 100, weight: 1, offsetDays: 7, status: "published", released: false }
];
var SEM2_ASMT_TEMPLATES = [
  { title: "Quiz 1", type: "quiz", catSuffix: "q", max: 20, weight: 1, offsetDays: 0, date: "2026-02-10", status: "published", released: false },
  { title: "Mid-Session Exam", type: "exam", catSuffix: "t", max: 100, weight: 2, offsetDays: 0, date: "2026-03-18", status: "published", released: false }
];
for (const off of offerings) {
  if (off.is_archived) continue;
  const templates = off.semester_id === SEM_ACTIVE ? SEM1_ASMT_TEMPLATES : SEM2_ASMT_TEMPLATES;
  for (const tmpl of templates) {
    asmtCounter += 1;
    assessments.push({
      id: `asmt-${asmtCounter}`,
      offering_id: off.id,
      // Denormalised from the offering, never chosen independently of it.
      semester_id: off.semester_id,
      category_id: tmpl.catSuffix ? `cat-${off.id}-${tmpl.catSuffix}` : null,
      title: tmpl.title,
      type: tmpl.type,
      max_score: tmpl.max,
      weight: tmpl.weight,
      assessment_date: tmpl.date ?? addDays(DEMO_TODAY, tmpl.offsetDays),
      status: tmpl.status,
      is_released: tmpl.released
    });
  }
}
var assessment_grades = [];
var rngGrade = makeRng(31337);
var gradeCounter = 0;
for (const asmt of assessments) {
  const roster = activeRoster(asmt.offering_id);
  for (const stu of roster) {
    const enr = activeEnrollment(stu.id, asmt.offering_id);
    if (!enr) continue;
    gradeCounter += 1;
    let status;
    let score = null;
    if (asmt.status === "graded") {
      const roll = rngGrade();
      if (roll < 0.06) status = "absent";
      else if (roll < 0.1) status = "excused";
      else if (roll < 0.12) status = "pending";
      else {
        status = "graded";
        const pct = Math.min(1, Math.max(0.45, 0.84 + (rngGrade() - 0.5) * 0.3));
        score = Math.round(pct * asmt.max_score);
      }
    } else {
      status = "pending";
    }
    assessment_grades.push({
      id: `grd-${gradeCounter}`,
      assessment_id: asmt.id,
      student_id: stu.id,
      enrollment_id: enr.id,
      status,
      score,
      makeup_score: null,
      is_released: null
      // inherit assessment.is_released
    });
  }
}
var attendance_records = [];
var rngAtt = makeRng(55555);
var attCounter = 0;
var attDates = [];
for (let d = -13; d <= 0; d += 1) {
  const iso = addDays(DEMO_TODAY, d);
  if (isWeekday(iso)) attDates.push(iso);
}
var principalUserId = "user-principal";
var attendanceRecorderUserId = teacherByCode("MATH1110").user_id ?? principalUserId;
for (const off of offerings.filter((o) => o.semester_id === SEM_ACTIVE)) {
  const roster = activeRoster(off.id);
  for (const date of attDates) {
    for (const stu of roster) {
      const enr = activeEnrollment(stu.id, off.id);
      if (!enr) continue;
      attCounter += 1;
      const roll = rngAtt();
      let status;
      if (roll < 0.9) status = "present";
      else if (roll < 0.95) status = "absent";
      else if (roll < 0.98) status = "late";
      else status = "excused";
      attendance_records.push({
        id: `att-${attCounter}`,
        offering_id: off.id,
        student_id: stu.id,
        enrollment_id: enr.id,
        semester_id: SEM_ACTIVE,
        attendance_date: date,
        status,
        recorded_by_user_id: attendanceRecorderUserId,
        recorded_at: `${date}T08:15:00Z`
      });
    }
  }
}
var announcements = [
  {
    id: "ann-1",
    title: "Welcome back to the 2025-2026 school year",
    body: "Classes resume Monday. Please collect timetables from the front office and review the updated code of conduct posted on the notice board.",
    audience: "all",
    offering_id: null,
    author_user_id: principalUserId,
    published_at: addDays(DEMO_TODAY, -20) + "T08:00:00Z",
    expires_at: null,
    read_by_user_ids: ["user-teach-1", "user-stu-1"]
  },
  {
    id: "ann-2",
    title: "Staff meeting \u2014 Thursday 3:30 PM",
    body: "All teaching staff should attend the session-planning meeting in the staff room. Department heads, please bring your assessment calendars.",
    audience: "teachers",
    offering_id: null,
    author_user_id: principalUserId,
    published_at: addDays(DEMO_TODAY, -6) + "T14:00:00Z",
    expires_at: addDays(DEMO_TODAY, 2) + "T00:00:00Z",
    read_by_user_ids: ["user-teach-1"]
  },
  {
    id: "ann-3",
    title: "Mid-session exam schedule released",
    body: "The mid-session timetable is now available. Review your subjects and prepare accordingly. Speak to your lecturers about any clashes.",
    audience: "students",
    offering_id: null,
    author_user_id: "user-secretary",
    published_at: addDays(DEMO_TODAY, -4) + "T10:00:00Z",
    expires_at: null,
    read_by_user_ids: []
  },
  {
    id: "ann-4",
    // Targeted at ONE OFFERING (D31). The audience enum keeps its `'class'` member — it is a
    // wire value shared by the ORM, API and handlers — but what it points at is an offering.
    title: "BIOL1102-01 \u2014 bring lab coats Friday",
    body: "For our first Biology practical this Friday, everyone in BIOL1102-01 must bring a lab coat and closed-toe shoes.",
    audience: "class",
    offering_id: offeringByKey("BIOL1102-01").id,
    author_user_id: "user-teach-3",
    published_at: addDays(DEMO_TODAY, -2) + "T11:30:00Z",
    expires_at: addDays(DEMO_TODAY, 3) + "T00:00:00Z",
    read_by_user_ids: []
  },
  {
    id: "ann-5",
    title: "Sports Day \u2014 save the date",
    body: "Annual Sports Day is scheduled for next month. House captains will be announced shortly. Get your teams ready!",
    audience: "all",
    offering_id: null,
    author_user_id: "user-teach-8",
    published_at: addDays(DEMO_TODAY, -1) + "T09:00:00Z",
    expires_at: null,
    read_by_user_ids: []
  },
  {
    id: "ann-6",
    title: "Library closed for stocktake (expired)",
    body: "The library was closed last week for the annual stocktake. It has since reopened for normal hours.",
    audience: "all",
    offering_id: null,
    author_user_id: "user-secretary",
    published_at: addDays(DEMO_TODAY, -12) + "T08:00:00Z",
    expires_at: addDays(DEMO_TODAY, -8) + "T00:00:00Z",
    // already expired
    read_by_user_ids: ["user-teach-1", "user-stu-1"]
  }
];
var eventCreatedAt = addDays(DEMO_TODAY, -25) + "T08:00:00Z";
var events = [
  {
    id: "evt-1",
    title: "Staff Development Day",
    description: "No classes for students. All teaching staff attend professional-development workshops.",
    category: "meeting",
    visibility: "internal",
    start_date: addDays(DEMO_TODAY, -6),
    end_date: null,
    all_day: true,
    start_time: null,
    end_time: null,
    location: "Main Hall",
    created_by_user_id: principalUserId,
    created_at: eventCreatedAt
  },
  {
    id: "evt-2",
    title: "Pan American Day",
    description: "Public holiday \u2014 school closed.",
    category: "holiday",
    visibility: "global",
    start_date: addDays(DEMO_TODAY, -3),
    end_date: null,
    all_day: true,
    start_time: null,
    end_time: null,
    location: null,
    created_by_user_id: "user-secretary",
    created_at: eventCreatedAt
  },
  {
    id: "evt-3",
    title: "School Photo Day",
    description: "Class and individual photographs. Students must be in full uniform.",
    category: "activity",
    visibility: "global",
    start_date: DEMO_TODAY,
    end_date: null,
    all_day: false,
    start_time: "09:00",
    end_time: "12:00",
    location: "Gymnasium",
    created_by_user_id: "user-secretary",
    created_at: eventCreatedAt
  },
  {
    id: "evt-4",
    title: "Session Planning \u2014 Staff Meeting",
    description: "All teaching staff meet to review the mid-session timetable and assessment calendar.",
    category: "meeting",
    visibility: "internal",
    start_date: addDays(DEMO_TODAY, 1),
    end_date: null,
    all_day: false,
    start_time: "17:00",
    end_time: "18:30",
    location: "Auditorium",
    created_by_user_id: principalUserId,
    created_at: eventCreatedAt
  },
  {
    id: "evt-5",
    title: "Mid-Session Examinations",
    description: "Mid-session exams across all forms. Refer to the posted timetable for your subjects.",
    category: "exam",
    visibility: "global",
    start_date: addDays(DEMO_TODAY, 5),
    end_date: addDays(DEMO_TODAY, 9),
    all_day: true,
    start_time: null,
    end_time: null,
    location: null,
    created_by_user_id: principalUserId,
    created_at: eventCreatedAt
  },
  {
    id: "evt-6",
    title: "Inter-House Sports Day",
    description: "Annual athletics competition between houses. Family and friends welcome to attend.",
    category: "activity",
    visibility: "global",
    start_date: addDays(DEMO_TODAY, 12),
    end_date: null,
    all_day: false,
    start_time: "08:00",
    end_time: "14:00",
    location: "Sports Field",
    created_by_user_id: "user-secretary",
    created_at: eventCreatedAt
  },
  {
    id: "evt-7",
    title: "First-Session Report Cards Issued",
    description: "Report cards for the first session are released to students and guardians.",
    category: "other",
    visibility: "global",
    start_date: addDays(DEMO_TODAY, 16),
    end_date: null,
    all_day: true,
    start_time: null,
    end_time: null,
    location: null,
    created_by_user_id: "user-secretary",
    created_at: eventCreatedAt
  },
  {
    id: "evt-8",
    title: "Garifuna Settlement Day",
    description: "National public holiday \u2014 school closed.",
    category: "holiday",
    visibility: "global",
    start_date: addDays(DEMO_TODAY, 35),
    end_date: null,
    all_day: true,
    start_time: null,
    end_time: null,
    location: null,
    created_by_user_id: principalUserId,
    created_at: eventCreatedAt
  }
];
var activeBands = [
  { letter: "A", min_score: 95, max_score: 100, grade_point: 4, is_passing: true, sort_order: 1 },
  { letter: "A-", min_score: 90, max_score: 94, grade_point: 3.75, is_passing: true, sort_order: 2 },
  { letter: "B+", min_score: 85, max_score: 89, grade_point: 3.5, is_passing: true, sort_order: 3 },
  { letter: "B", min_score: 80, max_score: 84, grade_point: 3, is_passing: true, sort_order: 4 },
  { letter: "C+", min_score: 75, max_score: 79, grade_point: 2.5, is_passing: true, sort_order: 5 },
  { letter: "C", min_score: 70, max_score: 74, grade_point: 2, is_passing: true, sort_order: 6 },
  { letter: "D", min_score: 65, max_score: 69, grade_point: 1, is_passing: false, sort_order: 7 },
  { letter: "F", min_score: 0, max_score: 64, grade_point: 0, is_passing: false, sort_order: 8 }
];
var archivedBands = [
  { letter: "A", min_score: 90, max_score: 100, grade_point: null, is_passing: true, sort_order: 1 },
  { letter: "B", min_score: 80, max_score: 89.99, grade_point: null, is_passing: true, sort_order: 2 },
  { letter: "C", min_score: 70, max_score: 79.99, grade_point: null, is_passing: true, sort_order: 3 },
  { letter: "D", min_score: 60, max_score: 69.99, grade_point: null, is_passing: true, sort_order: 4 },
  { letter: "F", min_score: 0, max_score: 59.99, grade_point: null, is_passing: false, sort_order: 5 }
];
var grading_scales = [
  { academic_year_id: YEAR_ACTIVE, pass_mark: 70, is_frozen: false, bands: activeBands },
  {
    academic_year_id: YEAR_ARCHIVED,
    pass_mark: 60,
    is_frozen: true,
    bands: archivedBands
  }
];
var assessment_policy = {
  absent_as_zero: true,
  allow_makeup: true,
  drop_lowest_count: 0,
  // D32 - seeded ON, unlike the server default. The demo's whole point is showing the
  // student experience, and a student with grades hidden has almost no screens left. To
  // see the hidden state, turn it off in Settings -> Assessment policy and reload as the
  // student: My Grades disappears from the nav and /grades redirects to /forbidden.
  students_can_view_grades: true
};
var HOD_TEACHER_ID = "teach-2";
var users = [];
function pushUser(u) {
  users.push({ locale: "en", theme: "light", date_format: null, default_page_size: 25, ...u });
}
pushUser({
  id: principalUserId,
  email: "principal@belmopancomp.edu.bz",
  username: "principal",
  full_name: "Alicia Mendez",
  role: "principal",
  is_active: true,
  must_change_password: false,
  last_login_at: DEMO_TODAY_ISO
});
pushUser({
  id: "user-secretary",
  email: "secretary@belmopancomp.edu.bz",
  username: "secretary",
  full_name: "Sofia Castillo",
  role: "secretary",
  is_active: true,
  must_change_password: false,
  last_login_at: addDays(DEMO_TODAY, -1) + "T07:45:00Z"
});
for (const t of teachers) {
  if (!t.user_id) continue;
  pushUser({
    id: t.user_id,
    email: t.email,
    username: t.email.split("@")[0],
    full_name: t.full_name,
    // D43 — the appointed head's LOGIN role is `hod`. The seed sets both because the
    // demo needs a working HOD to click through; in the real system these are two
    // separate acts (appoint on the programme page, change the role in Settings), which
    // is why `program_heads` above does not imply this.
    role: t.id === HOD_TEACHER_ID ? "hod" : "teacher",
    is_active: t.status === "active",
    must_change_password: false,
    last_login_at: addDays(DEMO_TODAY, -randInt(makeRng(t.id.length + 3), 0, 5)) + "T07:50:00Z"
  });
}
pushUser({
  id: "user-auditor",
  email: "auditor@belmopancomp.edu.bz",
  username: "auditor",
  full_name: "Ruth Bennett",
  // No lecturer or student profile: an auditor teaches nothing and studies nothing.
  role: "auditor",
  is_active: true,
  must_change_password: false,
  last_login_at: addDays(DEMO_TODAY, -2) + "T09:10:00Z"
});
for (const s of students) {
  if (!s.user_id) continue;
  pushUser({
    id: s.user_id,
    email: `${s.student_number.toLowerCase()}@student.belmopancomp.edu.bz`,
    username: s.student_number.toLowerCase(),
    full_name: s.full_name,
    role: "student",
    is_active: s.status === "Registered",
    must_change_password: false,
    last_login_at: addDays(DEMO_TODAY, -randInt(makeRng(s.id.length + 9), 0, 7)) + "T15:00:00Z"
  });
}
var HIST_ANCHOR = "2025-01-10";
var SEM_2024_1 = "sem-2024-1";
var histSeed = offeringSeed.filter((o) => (o.semesterId ?? SEM_ACTIVE) === SEM_ACTIVE);
var histOfferings = histSeed.map((o, i) => {
  const lead = o.teacherNames?.[0] ? teacherByName(o.teacherNames[0]) : teacherByCode(o.code);
  return {
    id: `off-2024-${i + 1}`,
    course_id: courseId(o.code),
    semester_id: SEM_2024_1,
    section_code: o.sectionCode,
    capacity: o.capacity,
    is_archived: true,
    teacher_ids: [lead.id],
    lead_teacher_id: lead.id,
    drop_lowest_count: o.code === "MATH1110" ? 1 : 0
  };
});
offerings.push(...histOfferings);
for (const off of histOfferings) {
  assessment_categories.push(
    { id: `cat-${off.id}-q`, offering_id: off.id, name: "Quizzes", weight: 0.4, drop_lowest_count: 1 },
    { id: `cat-${off.id}-t`, offering_id: off.id, name: "Tests", weight: 0.6, drop_lowest_count: 0 }
  );
}
var histEnrollmentId = /* @__PURE__ */ new Map();
var histEnrollCounter = 0;
var histTwinByOfferingId = new Map(
  histSeed.map((o, i) => [offeringByKey(o.key).id, histOfferings[i]])
);
for (const stu of students) {
  const current = loadByStudent.get(stu.id) ?? [];
  const keys = current.length > 0 ? current : FIRST_YEAR_LOADS[0];
  for (const key of keys) {
    const twin = histTwinByOfferingId.get(offeringByKey(key).id);
    if (!twin) continue;
    histEnrollCounter += 1;
    const enrId = `enr-2024-${histEnrollCounter}`;
    enrollments.push({
      id: enrId,
      student_id: stu.id,
      offering_id: twin.id,
      semester_id: SEM_2024_1,
      enrolled_at: "2024-09-02T08:00:00Z",
      unenrolled_at: null,
      // D35 — last year's rows are ordinary registrations.
      enrollment_status: "enrolled"
    });
    histEnrollmentId.set(`${stu.id}:${twin.id}`, enrId);
  }
}
function histRoster(offeringId) {
  const ids = enrollments.filter((e) => e.offering_id === offeringId && e.semester_id === SEM_2024_1 && !e.unenrolled_at).map((e) => e.student_id);
  return students.filter((s) => ids.includes(s.id));
}
var HIST_ASMT_TEMPLATES = [
  { title: "Quiz 1", type: "quiz", catSuffix: "q", max: 20, offsetDays: -90 },
  { title: "Quiz 2", type: "quiz", catSuffix: "q", max: 20, offsetDays: -60 },
  { title: "Mid-Session Test", type: "test", catSuffix: "t", max: 50, offsetDays: -30 },
  { title: "Final Project", type: "assignment", catSuffix: null, max: 100, offsetDays: -10 }
];
var histAssessments = [];
var histAsmtCounter = 0;
for (const off of histOfferings) {
  for (const tmpl of HIST_ASMT_TEMPLATES) {
    histAsmtCounter += 1;
    histAssessments.push({
      id: `asmt-2024-${histAsmtCounter}`,
      offering_id: off.id,
      semester_id: SEM_2024_1,
      category_id: tmpl.catSuffix ? `cat-${off.id}-${tmpl.catSuffix}` : null,
      title: tmpl.title,
      type: tmpl.type,
      max_score: tmpl.max,
      weight: 1,
      assessment_date: addDays(HIST_ANCHOR, tmpl.offsetDays),
      status: "graded",
      is_released: true
    });
  }
}
assessments.push(...histAssessments);
var rngHistGrade = makeRng(24680);
var histGradeCounter = 0;
for (const asmt of histAssessments) {
  for (const stu of histRoster(asmt.offering_id)) {
    const enrId = histEnrollmentId.get(`${stu.id}:${asmt.offering_id}`);
    if (!enrId) continue;
    histGradeCounter += 1;
    const roll = rngHistGrade();
    let status = "graded";
    let score = null;
    if (roll < 0.05) status = "absent";
    else if (roll < 0.08) status = "excused";
    else {
      status = "graded";
      const pct = Math.min(1, Math.max(0.4, 0.78 + (rngHistGrade() - 0.5) * 0.4));
      score = Math.round(pct * asmt.max_score);
    }
    assessment_grades.push({
      id: `grd-2024-${histGradeCounter}`,
      assessment_id: asmt.id,
      student_id: stu.id,
      enrollment_id: enrId,
      status,
      score,
      makeup_score: null,
      is_released: true
    });
  }
}
var histAttDates = [];
for (let d = -13; d <= 0; d += 1) {
  const iso = addDays(HIST_ANCHOR, d);
  if (isWeekday(iso)) histAttDates.push(iso);
}
var rngHistAtt = makeRng(99999);
var histAttCounter = 0;
for (const off of histOfferings) {
  const roster = histRoster(off.id);
  for (const date of histAttDates) {
    for (const stu of roster) {
      const enrId = histEnrollmentId.get(`${stu.id}:${off.id}`);
      if (!enrId) continue;
      histAttCounter += 1;
      const roll = rngHistAtt();
      let status;
      if (roll < 0.9) status = "present";
      else if (roll < 0.95) status = "absent";
      else if (roll < 0.98) status = "late";
      else status = "excused";
      attendance_records.push({
        id: `att-2024-${histAttCounter}`,
        offering_id: off.id,
        student_id: stu.id,
        enrollment_id: enrId,
        semester_id: SEM_2024_1,
        attendance_date: date,
        status,
        recorded_by_user_id: attendanceRecorderUserId,
        recorded_at: `${date}T08:15:00Z`
      });
    }
  }
}
var programs = BAJC_PROGRAMS.map(
  ([code, name, award, totalCredits, minGp]) => ({
    id: `prog-${code.toLowerCase()}`,
    code,
    name,
    award,
    total_credits: totalCredits,
    min_passing_grade_point: minGp,
    is_active: true
  })
);
var programId = (code) => `prog-${code.toLowerCase()}`;
var program_courses = BAJC_CURRICULUM.flatMap(
  ([progCode, termLabel, termOrder, codes]) => codes.map((code, i) => ({
    id: `pc-${progCode.toLowerCase()}-${termOrder}-${i}`,
    program_id: programId(progCode),
    course_id: courseId(code),
    term_label: termLabel,
    term_order: termOrder,
    // Every course printed on a sequence counts toward the award; the PDF marks no
    // electives (see the backend catalog's note on the unexplained `*` footnotes).
    is_required: true
  }))
);
var hodProgramId = (() => {
  const taughtCourseIds = new Set(
    offerings.filter((o) => o.teacher_ids.includes(HOD_TEACHER_ID)).map((o) => o.course_id)
  );
  return program_courses.find((pc) => taughtCourseIds.has(pc.course_id))?.program_id;
})();
var program_heads = hodProgramId ? [
  {
    id: "phead-1",
    program_id: hodProgramId,
    teacher_id: HOD_TEACHER_ID,
    appointed_at: DEMO_TODAY_ISO
  }
] : [];
var course_prerequisites = [
  ...BAJC_PREREQUISITES.map(([courseCode, requiredCode], i) => ({
    id: `prereq-${i + 1}`,
    course_id: courseId(courseCode),
    prerequisite_course_id: courseId(requiredCode),
    program_id: null,
    requirement_type: "course"
  })),
  // `EDUC3201` (Internship) <- literally "ALL COURSES" on the Primary Education
  // sequence. A list of course ids could never say that.
  ...BAJC_ALL_COURSE_GATES.map(([courseCode, progCode], i) => ({
    id: `prereq-all-${i + 1}`,
    course_id: courseId(courseCode),
    prerequisite_course_id: null,
    program_id: programId(progCode),
    requirement_type: "all_program_courses"
  }))
];
var applicationsSeed = [
  {
    id: "app-draft-1",
    status: "draft",
    school_year: "2026-2027",
    first_name: "Marisol",
    middle_name: null,
    last_name: "Canto",
    date_of_birth: "2007-11-14",
    ssno: null,
    gender: "female",
    civil_status: null,
    religion: null,
    phone: "+501-6220145",
    email: "marisol.canto@example.bz",
    has_health_condition: false,
    health_condition_note: null,
    street: "18 Santa Rita Road",
    city_town_village: "Corozal Town",
    district: "Corozal",
    mother_name: "Delmy Canto",
    father_name: null,
    nok_name: "Delmy Canto",
    nok_relationship: "Mother",
    nok_phone: "+501-6220146",
    atlib_exam: false,
    num_csec: null,
    finance_name: null,
    finance_phone: null,
    finance_email: null,
    recommendation_received: false,
    // Sections C–G are still blank. That is the point of a draft.
    program_id: null,
    year_of_study: null,
    enrollment_load: null,
    applicant_signed_at: null,
    guardian_signed_at: null,
    date_accepted: null,
    academic_year_id: null,
    enrolment_status: null,
    student_code: null,
    comments: null,
    decided_by_user_id: null,
    decided_at: null,
    student_id: null,
    created_at: "2025-10-02T14:05:00Z",
    updated_at: "2025-10-02T14:22:00Z"
  },
  {
    id: "app-ready-1",
    status: "submitted",
    school_year: "2026-2027",
    first_name: "Presley",
    middle_name: "A",
    last_name: "Rancharan",
    date_of_birth: "2006-05-02",
    ssno: "412885031",
    gender: "male",
    civil_status: "Single",
    religion: "Adventist",
    phone: "+501-6311902",
    email: "presley.rancharan@example.bz",
    has_health_condition: false,
    health_condition_note: null,
    street: "4 Calcutta Village Road",
    city_town_village: "Calcutta",
    district: "Corozal",
    mother_name: "Indira Rancharan",
    father_name: "Errol Rancharan",
    nok_name: "Indira Rancharan",
    nok_relationship: "Mother",
    nok_phone: "+501-6311903",
    atlib_exam: true,
    num_csec: 7,
    finance_name: "Errol Rancharan",
    finance_phone: "+501-6311904",
    finance_email: "errol.rancharan@example.bz",
    recommendation_received: true,
    program_id: "prog-bmad",
    year_of_study: "First",
    enrollment_load: "Full Time",
    applicant_signed_at: "2025-09-28",
    guardian_signed_at: null,
    // an adult — the under-18 rule does not apply
    date_accepted: null,
    academic_year_id: null,
    enrolment_status: null,
    student_code: null,
    comments: null,
    decided_by_user_id: null,
    decided_at: null,
    student_id: null,
    created_at: "2025-09-28T09:10:00Z",
    updated_at: "2025-09-29T11:40:00Z"
  },
  {
    id: "app-transfer-1",
    status: "under_review",
    school_year: "2026-2027",
    first_name: "Kenrick",
    middle_name: null,
    last_name: "Bevans",
    date_of_birth: "2003-02-19",
    ssno: "399120884",
    gender: "male",
    civil_status: "Single",
    religion: null,
    phone: "+501-6704411",
    email: "kenrick.bevans@example.bz",
    has_health_condition: false,
    health_condition_note: null,
    street: "92 Orange Walk Street",
    city_town_village: "Orange Walk Town",
    district: "Orange Walk",
    mother_name: "Sonia Bevans",
    father_name: null,
    nok_name: "Sonia Bevans",
    nok_relationship: "Mother",
    nok_phone: "+501-6704412",
    atlib_exam: false,
    num_csec: 5,
    finance_name: "Self",
    finance_phone: "+501-6704411",
    finance_email: null,
    recommendation_received: true,
    program_id: "prog-itec",
    year_of_study: "Second",
    enrollment_load: "Part Time",
    applicant_signed_at: "2025-09-20",
    guardian_signed_at: null,
    date_accepted: null,
    academic_year_id: null,
    enrolment_status: null,
    student_code: null,
    comments: "Transferring from the University of Belize. CTA and transcript received.",
    decided_by_user_id: null,
    decided_at: null,
    student_id: null,
    created_at: "2025-09-20T08:00:00Z",
    updated_at: "2025-10-01T15:30:00Z"
  },
  {
    id: "app-accepted-1",
    status: "accepted",
    school_year: "2025-2026",
    first_name: students[0].first_name ?? students[0].last_name,
    middle_name: students[0].middle_name,
    last_name: students[0].last_name,
    date_of_birth: students[0].date_of_birth,
    ssno: null,
    gender: students[0].gender,
    civil_status: null,
    religion: null,
    phone: students[0].phone,
    email: `${students[0].last_name.toLowerCase()}.applicant@example.bz`,
    has_health_condition: false,
    health_condition_note: null,
    street: null,
    city_town_village: null,
    district: "Corozal",
    mother_name: null,
    father_name: null,
    nok_name: students[0].guardian_name,
    nok_relationship: "Guardian",
    nok_phone: students[0].guardian_phone,
    atlib_exam: true,
    num_csec: 8,
    finance_name: students[0].guardian_name,
    finance_phone: students[0].guardian_phone,
    finance_email: null,
    recommendation_received: true,
    program_id: students[0].program_id,
    year_of_study: "First",
    enrollment_load: "Full Time",
    applicant_signed_at: "2025-08-10",
    guardian_signed_at: null,
    date_accepted: "2025-08-18",
    academic_year_id: YEAR_ACTIVE,
    enrolment_status: "Full Time",
    student_code: students[0].student_number,
    comments: "Accepted for the 2025-2026 intake.",
    decided_by_user_id: principalUserId,
    decided_at: "2025-08-18T16:00:00Z",
    student_id: students[0].id,
    created_at: "2025-08-05T10:00:00Z",
    updated_at: "2025-08-18T16:00:00Z"
  }
];
var application_temp = [
  {
    id: "temp-1",
    status: "pending",
    school_year: "2026-2027",
    first_name: "Delphine",
    middle_name: null,
    last_name: "Waight",
    date_of_birth: "2008-03-21",
    ssno: null,
    gender: "female",
    civil_status: null,
    religion: "Catholic",
    phone: "+501-6701188",
    email: "delphine.waight@example.bz",
    has_health_condition: false,
    health_condition_note: null,
    street: "4 Mahogany Street",
    city_town_village: "Belmopan",
    district: "Cayo",
    mother_name: "Ivy Waight",
    father_name: null,
    nok_name: "Ivy Waight",
    nok_relationship: "Mother",
    nok_phone: "+501-6701189",
    atlib_exam: false,
    num_csec: 6,
    finance_name: null,
    finance_phone: null,
    finance_email: null,
    recommendation_received: false,
    // Missing on purpose — these are what `blocking_issues` will report.
    program_id: null,
    year_of_study: null,
    enrollment_load: null,
    applicant_signed_at: null,
    guardian_signed_at: null,
    academic_year_id: null,
    enrolment_status: null,
    comments: null,
    created_by: "user-secretary",
    created_by_name: "Sofia Castillo",
    created_at: "2026-07-30T09:15:00Z",
    updated_at: "2026-08-04T14:40:00Z",
    education: [
      {
        id: "temp-1-edu-1",
        application_id: "temp-1",
        institution: "Belmopan Comprehensive School",
        education_level: "High School",
        graduated: true,
        graduation_date: "2026-06-26",
        sort_order: 1
      }
    ],
    documents: [
      {
        id: "temp-1-doc-1",
        application_id: "temp-1",
        document_type: "transcript",
        file_name: null,
        content_type: null,
        size_bytes: null,
        received: true
      }
    ]
  },
  {
    id: "temp-2",
    status: "pending",
    school_year: "2026-2027",
    first_name: "Rolando",
    middle_name: "A",
    last_name: "Zetina",
    date_of_birth: "2005-01-09",
    ssno: null,
    gender: "male",
    civil_status: "Single",
    religion: null,
    phone: "+501-6335512",
    email: "rolando.zetina@example.bz",
    has_health_condition: false,
    health_condition_note: null,
    street: "77 Front Street",
    city_town_village: "Dangriga",
    district: "Stann Creek",
    mother_name: null,
    father_name: "Neri Zetina",
    nok_name: "Neri Zetina",
    nok_relationship: "Father",
    nok_phone: "+501-6335513",
    atlib_exam: true,
    num_csec: 8,
    finance_name: "Neri Zetina",
    finance_phone: "+501-6335513",
    finance_email: null,
    recommendation_received: true,
    program_id: programs[0].id,
    year_of_study: "First",
    enrollment_load: "Full Time",
    applicant_signed_at: "2026-08-10",
    guardian_signed_at: null,
    academic_year_id: null,
    enrolment_status: null,
    comments: null,
    // A Registrar the demo has no login for, so the scope rule is observable.
    created_by: "user-registrar-2",
    created_by_name: "Karen Requena",
    created_at: "2026-08-11T08:05:00Z",
    updated_at: "2026-08-11T08:52:00Z",
    education: [
      {
        id: "temp-2-edu-1",
        application_id: "temp-2",
        institution: "Ecumenical High School",
        education_level: "High School",
        graduated: true,
        graduation_date: "2023-06-30",
        sort_order: 1
      }
    ],
    documents: []
  }
];
var application_education = [
  {
    id: "appedu-1",
    application_id: "app-draft-1",
    institution: "Corozal Community College",
    education_level: "High School",
    graduated: true,
    graduation_date: "2025-06-27",
    sort_order: 1
  },
  {
    id: "appedu-2",
    application_id: "app-ready-1",
    institution: "Corozal Community College",
    education_level: "High School",
    graduated: true,
    graduation_date: "2024-06-28",
    sort_order: 1
  },
  {
    id: "appedu-3",
    application_id: "app-transfer-1",
    institution: "Escuela Secundaria T\xE9cnica M\xE9xico",
    education_level: "High School",
    graduated: true,
    graduation_date: "2021-07-02",
    sort_order: 1
  },
  {
    // The TERTIARY row is what makes the credit transfer approvable at all: policy allows
    // transfer only from a recognised tertiary institution, and the server checks Section B
    // for one before it lets the Dean approve.
    id: "appedu-4",
    application_id: "app-transfer-1",
    institution: "University of Belize",
    education_level: "Tertiary",
    graduated: false,
    graduation_date: null,
    sort_order: 2
  }
];
var application_documents = [
  { id: "appdoc-1", application_id: "app-draft-1", document_type: "passport_photo", file_name: null, content_type: null, size_bytes: null, received: true },
  { id: "appdoc-2", application_id: "app-ready-1", document_type: "passport_photo", file_name: null, content_type: null, size_bytes: null, received: true },
  { id: "appdoc-3", application_id: "app-ready-1", document_type: "hs_diploma", file_name: null, content_type: null, size_bytes: null, received: true },
  { id: "appdoc-4", application_id: "app-ready-1", document_type: "recommendation_form", file_name: null, content_type: null, size_bytes: null, received: true },
  { id: "appdoc-5", application_id: "app-ready-1", document_type: "social_security_card", file_name: null, content_type: null, size_bytes: null, received: false },
  { id: "appdoc-6", application_id: "app-transfer-1", document_type: "passport_photo", file_name: null, content_type: null, size_bytes: null, received: true },
  { id: "appdoc-7", application_id: "app-transfer-1", document_type: "cta", file_name: "cta-bevans.pdf", content_type: "application/pdf", size_bytes: 184320, received: true },
  { id: "appdoc-8", application_id: "app-transfer-1", document_type: "transcript", file_name: "ub-transcript.pdf", content_type: "application/pdf", size_bytes: 262144, received: true },
  { id: "appdoc-9", application_id: "app-transfer-1", document_type: "course_outline", file_name: "ub-outlines.pdf", content_type: "application/pdf", size_bytes: 331776, received: true }
];
var credit_transfer_requests = [
  {
    id: "cta-1",
    application_id: "app-transfer-1",
    external_institution: "University of Belize",
    external_course_code: "CMPS1011",
    external_course_name: "Introduction to Programming",
    external_credits: 3,
    external_grade: "B+",
    target_course_id: courseId("ITEC1104"),
    content_equivalency_pct: null,
    cta_document_id: "appdoc-7",
    transcript_document_id: "appdoc-8",
    outline_document_id: "appdoc-9",
    status: "pending",
    decided_by_user_id: null,
    decided_at: null,
    note: null,
    created_at: "2025-10-01T15:30:00Z"
  }
];
var student_program_history = students.filter((student) => student.program_id !== null).map((student, index) => ({
  id: `sph-${index + 1}`,
  student_id: student.id,
  program_id: student.program_id,
  started_at: student.enrollment_date,
  ended_at: null,
  reason: "Admitted"
}));
var revisableGrade = (() => {
  const teacherId = teachers.find((t) => t.user_id === "user-teach-1")?.id ?? teachers[0]?.id;
  const owned = new Set(
    offerings.filter((o) => o.teacher_ids.includes(teacherId)).map((o) => o.id)
  );
  const ownedAssessments = new Set(
    assessments.filter((a) => owned.has(a.offering_id) && a.status === "graded").map((a) => a.id)
  );
  return assessment_grades.find(
    (g) => ownedAssessments.has(g.assessment_id) && g.status === "graded" && g.score != null
  );
})();
var grade_revision_requests = revisableGrade ? [
  {
    id: "rev-seed-1",
    assessment_grade_id: revisableGrade.id,
    requested_by_user_id: "user-teach-1",
    reason: "The second essay question was marked out of 10 but is worth 20. Re-marked, the student gains 8.",
    original_score: revisableGrade.score,
    // Capped at the assessment's ceiling, so the seed can never be an invalid request.
    proposed_score: Math.min(
      (revisableGrade.score ?? 0) + 8,
      assessments.find((a) => a.id === revisableGrade.assessment_id)?.max_score ?? 100
    ),
    status: "pending",
    decided_by_user_id: null,
    decided_at: null,
    decision_note: null,
    created_at: "2025-10-14T10:30:00Z"
  }
] : [];
(() => {
  const active = enrollments.filter(
    (e) => e.semester_id === SEM_ACTIVE && !e.unenrolled_at && e.student_id !== "stu-1" && e.student_id !== "stu-2"
  );
  const mark = (index, status) => {
    const row = active[index];
    if (row) row.enrollment_status = status;
  };
  mark(3, "audit");
  mark(11, "withdraw_passing");
  mark(19, "withdraw_failing");
  mark(27, "audit");
})();
var DEMO_DATASET = {
  school_profile,
  religions,
  academic_years,
  semesters,
  courses,
  programs,
  program_courses,
  program_heads,
  course_prerequisites,
  offerings,
  teachers,
  students,
  offering_meetings,
  enrollments,
  assessment_categories,
  assessments,
  assessment_grades,
  attendance_records,
  announcements,
  events,
  grading_scales,
  assessment_policy,
  users,
  applications: applicationsSeed,
  application_temp,
  application_education,
  application_documents,
  credit_transfer_requests,
  student_program_history,
  grade_revision_requests
};
var DEMO_IDS = {
  activeYearId: YEAR_ACTIVE,
  archivedYearId: YEAR_ARCHIVED,
  activeSemesterId: SEM_ACTIVE,
  principalUserId
};

// src/shared/api/mocks/demo/selectors.ts
var D = DEMO_DATASET;
function paginate(items, params = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.page_size ?? 25));
  let sorted = items;
  if (params.sort) {
    const desc = params.sort.startsWith("-");
    const field = desc ? params.sort.slice(1) : params.sort;
    sorted = [...items].sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      if (cmp === 0) cmp = String(a.id ?? "").localeCompare(String(b.id ?? ""));
      return desc ? -cmp : cmp;
    });
  }
  const total = sorted.length;
  const start = (page - 1) * pageSize;
  return {
    items: sorted.slice(start, start + pageSize),
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize))
  };
}
function textIncludes(haystack, needle) {
  return (haystack ?? "").toLowerCase().includes(needle.toLowerCase());
}
var getCourse = (id) => D.courses.find((c) => c.id === id);
var getOffering = (id) => D.offerings.find((o) => o.id === id);
var getTeacher = (id) => D.teachers.find((t) => t.id === id);
var getStudent = (id) => D.students.find((s) => s.id === id);
var getSemester = (id) => D.semesters.find((s) => s.id === id);
function offeringLabel(offering) {
  if (!offering) return "";
  const course = getCourse(offering.course_id);
  const code = course?.code ?? "?";
  return offering.section_code ? `${code}-${offering.section_code}` : code;
}
function compareOfferings(a, b) {
  const ac = getCourse(a.course_id)?.code ?? "";
  const bc = getCourse(b.course_id)?.code ?? "";
  return ac.localeCompare(bc) || (a.section_code ?? "").localeCompare(b.section_code ?? "") || a.id.localeCompare(b.id);
}
function yearIdOfOffering(offeringId) {
  const offering = getOffering(offeringId);
  return offering ? getSemester(offering.semester_id)?.academic_year_id : void 0;
}
var getActiveSemester = () => D.semesters.find((s) => s.is_active);
var getActiveYear = () => D.academic_years.find((y) => y.status === "active");
var getActiveGradingScale = () => D.grading_scales.find((g) => g.academic_year_id === DEMO_IDS.activeYearId);
function offeringsForYear(yearId) {
  const semIds = new Set(D.semesters.filter((s) => s.academic_year_id === yearId).map((s) => s.id));
  return D.offerings.filter((o) => semIds.has(o.semester_id));
}
function semesterIdForOffering(offeringId) {
  return getOffering(offeringId)?.semester_id ?? DEMO_IDS.activeSemesterId;
}
function studentIdsForYear(yearId) {
  const semIds = new Set(D.semesters.filter((s) => s.academic_year_id === yearId).map((s) => s.id));
  return new Set(D.enrollments.filter((e) => semIds.has(e.semester_id)).map((e) => e.student_id));
}
function teacherIdsForYear(yearId) {
  const ids = /* @__PURE__ */ new Set();
  for (const off of offeringsForYear(yearId)) off.teacher_ids.forEach((tid) => ids.add(tid));
  return ids;
}
function yearsForStudent(studentId) {
  const yearIds = new Set(
    D.enrollments.filter((e) => e.student_id === studentId).map((e) => D.semesters.find((s) => s.id === e.semester_id)?.academic_year_id).filter((id) => Boolean(id))
  );
  return D.academic_years.filter((y) => yearIds.has(y.id)).sort((a, b) => b.name.localeCompare(a.name));
}
function offeringsForStudentInYear(studentId, yearId) {
  const semIds = new Set(D.semesters.filter((s) => s.academic_year_id === yearId).map((s) => s.id));
  const seen = /* @__PURE__ */ new Map();
  for (const e of D.enrollments) {
    if (e.student_id !== studentId || !semIds.has(e.semester_id)) continue;
    const off = getOffering(e.offering_id);
    if (off && !seen.has(off.id)) seen.set(off.id, off);
  }
  return [...seen.values()].sort(compareOfferings);
}
function currentOfferingsFor(studentId) {
  const seen = /* @__PURE__ */ new Map();
  for (const e of D.enrollments) {
    if (e.student_id !== studentId) continue;
    if (e.semester_id !== DEMO_IDS.activeSemesterId || e.unenrolled_at) continue;
    const off = getOffering(e.offering_id);
    if (off && !seen.has(off.id)) seen.set(off.id, off);
  }
  return [...seen.values()].sort(compareOfferings);
}
function offeringsForStudent(studentId, yearId) {
  return yearId ? offeringsForStudentInYear(studentId, yearId) : currentOfferingsFor(studentId);
}
function meetingsForOffering(offeringId) {
  return D.offering_meetings.filter((m) => m.offering_id === offeringId).sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time));
}
var DEMO_REPRESENTATIVE_USER_ID = {
  principal: DEMO_IDS.principalUserId,
  secretary: "user-secretary",
  teacher: "user-teach-1",
  // Maria Reyes — leads several offerings
  student: "user-stu-1",
  // Freddy Lopez — active, first-year, MATH1110-01
  // D43. A DIFFERENT person from the lecturer login on purpose: if both resolved to
  // Maria, nothing on screen would distinguish "what a lecturer sees" from "what a head
  // sees", and the demo would appear to prove a scoping rule it never exercised.
  hod: "user-teach-2",
  auditor: "user-auditor"
};
function demoHodProgramIds(role) {
  if (role !== "hod") return [];
  const userId = DEMO_REPRESENTATIVE_USER_ID.hod;
  const teacher = D.teachers.find((t) => t.user_id === userId);
  if (!teacher) return [];
  return D.program_heads.filter((h) => h.teacher_id === teacher.id).map((h) => h.program_id);
}
function demoHodOfferingIds(role) {
  const programIds = new Set(demoHodProgramIds(role));
  if (programIds.size === 0) return [];
  const courseIds = new Set(
    D.program_courses.filter((pc) => programIds.has(pc.program_id)).map((pc) => pc.course_id)
  );
  return D.offerings.filter((o) => courseIds.has(o.course_id)).map((o) => o.id);
}
function demoHodStudentIds(role) {
  const programIds = new Set(demoHodProgramIds(role));
  if (programIds.size === 0) return [];
  return D.students.filter((s) => s.program_id !== null && programIds.has(s.program_id)).map((s) => s.id);
}
function demoHodTeacherIds(role) {
  const offeringIds = new Set(demoHodOfferingIds(role));
  if (offeringIds.size === 0) return [];
  const ids = /* @__PURE__ */ new Set();
  for (const o of D.offerings) {
    if (offeringIds.has(o.id)) for (const t of o.teacher_ids) ids.add(t);
  }
  return [...ids];
}
function currentDemoHodTeacher(role) {
  if (role !== "hod") return void 0;
  return D.teachers.find((t) => t.user_id === DEMO_REPRESENTATIVE_USER_ID.hod);
}
function currentDemoStudent(role) {
  if (role !== "student") return void 0;
  return D.students.find((s) => s.user_id === DEMO_REPRESENTATIVE_USER_ID.student);
}
function currentDemoTeacher(role) {
  if (role !== "teacher") return void 0;
  return D.teachers.find((t) => t.user_id === DEMO_REPRESENTATIVE_USER_ID.teacher);
}
function studentReligions() {
  return [...new Set(D.students.map((s) => s.religion).filter((r) => Boolean(r)))].sort();
}
function studentCivilStatuses() {
  return [
    ...new Set(D.students.map((s) => s.civil_status).filter((c) => Boolean(c)))
  ].sort();
}
function listStudents(params = {}) {
  let rows = D.students;
  if (params.academic_year_id && params.academic_year_id !== DEMO_IDS.activeYearId) {
    const ids = studentIdsForYear(params.academic_year_id);
    rows = rows.filter((s) => ids.has(s.id));
  }
  if (params.teacher_id) {
    const ownedIds = new Set(offeringsOwnedByTeacher(params.teacher_id).map((o) => o.id));
    rows = rows.filter((s) => currentOfferingsFor(s.id).some((o) => ownedIds.has(o.id)));
  }
  if (params.student_ids) {
    const allowed = new Set(params.student_ids);
    rows = rows.filter((s) => allowed.has(s.id));
  }
  if (params.status) rows = rows.filter((s) => s.status === params.status);
  if (params.offering_id) {
    const wanted = params.offering_id;
    rows = rows.filter((s) => currentOfferingsFor(s.id).some((o) => o.id === wanted));
  }
  if (params.year_of_study) rows = rows.filter((s) => s.year_of_study === params.year_of_study);
  if (params.gender) rows = rows.filter((s) => s.gender === params.gender);
  if (params.religion) rows = rows.filter((s) => s.religion === params.religion);
  if (params.civil_status) rows = rows.filter((s) => s.civil_status === params.civil_status);
  if (params.program_id) rows = rows.filter((s) => s.program_id === params.program_id);
  if (params.search) {
    const q = params.search;
    rows = rows.filter(
      (s) => textIncludes(s.full_name, q) || textIncludes(s.first_name, q) || textIncludes(s.last_name, q) || textIncludes(s.student_number, q)
    );
  }
  const sort = params.sort ?? "last_name";
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort;
  if (["last_name", "first_name", "name", "full_name"].includes(key)) {
    const primary = key === "first_name" ? "first_name" : "last_name";
    const secondary = key === "first_name" ? "last_name" : "first_name";
    rows = [...rows].sort((a, b) => {
      const cmp = (a[primary] ?? "").localeCompare(b[primary] ?? "") || (a[secondary] ?? "").localeCompare(b[secondary] ?? "") || a.id.localeCompare(b.id);
      return desc ? -cmp : cmp;
    });
    return paginate(rows, {
      ...params,
      sort: void 0
    });
  }
  return paginate(rows, {
    ...params,
    sort
  });
}
function listTeachers(params = {}) {
  let rows = D.teachers;
  if (params.teacher_ids) {
    const allowed = new Set(params.teacher_ids);
    rows = rows.filter((t) => allowed.has(t.id));
  }
  if (params.academic_year_id && params.academic_year_id !== DEMO_IDS.activeYearId) {
    const ids = teacherIdsForYear(params.academic_year_id);
    rows = rows.filter((t) => ids.has(t.id));
  }
  if (params.status) rows = rows.filter((t) => t.status === params.status);
  if (params.specialization) {
    rows = rows.filter(
      (t) => t.subject_specializations.some((s) => textIncludes(s, params.specialization))
    );
  }
  if (params.search) {
    const q = params.search;
    rows = rows.filter((t) => textIncludes(t.full_name, q) || textIncludes(t.staff_number, q));
  }
  return paginate(rows, {
    ...params,
    sort: params.sort ?? "full_name"
  });
}
function offeringsOwnedByTeacher(teacherId) {
  return D.offerings.filter((o) => o.teacher_ids.includes(teacherId));
}
function rosterFor(offeringId) {
  const semId = semesterIdForOffering(offeringId);
  const ids = D.enrollments.filter((e) => e.offering_id === offeringId && e.semester_id === semId && !e.unenrolled_at).map((e) => e.student_id);
  return D.students.filter((s) => ids.includes(s.id));
}
function activeEnrollmentFor(studentId, offeringId) {
  const semId = semesterIdForOffering(offeringId);
  return D.enrollments.find(
    (e) => e.student_id === studentId && e.offering_id === offeringId && e.semester_id === semId && !e.unenrolled_at
  );
}
function assessmentsForOffering(offeringId) {
  return D.assessments.filter((a) => a.offering_id === offeringId);
}
function midtermRevisionEligible(a, g) {
  const sem = getSemester(a.semester_id);
  if (!sem) return { eligible: false, reason: "not_current_semester" };
  const start = sem.midterm_submission_start;
  const end = sem.midterm_submission_end;
  if (!start || !end) return { eligible: false, reason: "no_midterm_window" };
  const now = new Date(DEMO_TODAY_ISO).getTime();
  if (now <= new Date(end).getTime()) {
    return { eligible: false, reason: "midterm_window_open" };
  }
  const openedAt = new Date(start).getTime();
  const worked = a.assessment_date ? new Date(a.assessment_date).getTime() : null;
  if (worked === null || worked >= openedAt) {
    return { eligible: false, reason: "assessment_after_window" };
  }
  if (!g) return { eligible: false, reason: "not_graded" };
  if (g.status !== "graded" || g.score == null) {
    return { eligible: false, reason: "not_graded" };
  }
  if (!sem.is_active) return { eligible: false, reason: "not_current_semester" };
  return { eligible: true, reason: null };
}
function gradebookFor(offeringId) {
  const offering = getOffering(offeringId);
  const asmts = assessmentsForOffering(offeringId);
  const asmtIds = new Set(asmts.map((a) => a.id));
  const activeStudents = offering ? rosterFor(offering.id) : [];
  const gradedStudentIds = new Set(
    D.assessment_grades.filter((g) => asmtIds.has(g.assessment_id)).map((g) => g.student_id)
  );
  const activeIds = new Set(activeStudents.map((s) => s.id));
  const extraStudents = D.students.filter((s) => gradedStudentIds.has(s.id) && !activeIds.has(s.id));
  const allStudents = [...activeStudents, ...extraStudents];
  const rows = allStudents.map((student) => {
    const isActive = activeIds.has(student.id);
    const enr = offering ? activeEnrollmentFor(student.id, offering.id) : void 0;
    const cells = asmts.map((a) => {
      const g = D.assessment_grades.find(
        (row) => row.assessment_id === a.id && row.student_id === student.id
      );
      const released = g?.is_released ?? a.is_released;
      const revision = midtermRevisionEligible(a, g);
      return {
        assessment_id: a.id,
        status: g?.status ?? "pending",
        score: g?.score ?? null,
        makeup_score: g?.makeup_score ?? null,
        is_released: released,
        ...g?.status === "graded" && g.score != null ? { letter: letterFor(g.score / a.max_score * 100) } : {},
        // D32. The handler zeroes this for non-Lecturer viewers — the selector has no
        // caller identity, and the server's rule is "may YOU file one".
        can_request_revision: revision.eligible,
        revision_blocked_reason: revision.reason
      };
    });
    const term = computeTermGrade(student.id, offeringId);
    return {
      student,
      enrollment_id: enr?.id ?? null,
      is_active_member: isActive,
      cells,
      term_numeric: term.numeric,
      term_letter: term.letter
    };
  });
  return { offering, assessments: asmts, rows };
}
function computeTermGrade(studentId, offeringId) {
  const asmts = assessmentsForOffering(offeringId).filter((a) => a.status === "graded");
  let weightedSum = 0;
  let weightBase = 0;
  for (const a of asmts) {
    const g = D.assessment_grades.find(
      (row) => row.assessment_id === a.id && row.student_id === studentId
    );
    if (!g) continue;
    let effectiveScore = null;
    if (g.status === "graded" && g.score != null) effectiveScore = g.score;
    else if (g.status === "absent") {
      if (g.makeup_score != null) effectiveScore = g.makeup_score;
      else if (D.assessment_policy.absent_as_zero) effectiveScore = 0;
      else continue;
    } else {
      continue;
    }
    const pct = effectiveScore / a.max_score * 100;
    weightedSum += pct * a.weight;
    weightBase += a.weight;
  }
  if (weightBase === 0) return { numeric: null, letter: null, weight_base_used: 0 };
  const numeric = Math.round(weightedSum / weightBase * 100) / 100;
  return { numeric, letter: letterFor(numeric), weight_base_used: weightBase };
}
function letterFor(numeric) {
  const scale = getActiveGradingScale();
  if (!scale) return "";
  const clamped = Math.min(Math.max(numeric, 0), 100);
  const ordered = [...scale.bands].sort((a, b) => b.min_score - a.min_score);
  const band = ordered.find((b) => clamped >= b.min_score);
  return (band ?? ordered[ordered.length - 1])?.letter ?? "";
}
function gradePointFor(letter) {
  if (!letter) return null;
  const scale = getActiveGradingScale();
  const wanted = letter.trim().toLowerCase();
  const band = scale?.bands.find((b) => b.letter.trim().toLowerCase() === wanted);
  return band?.grade_point ?? null;
}
function gpaFor(entries) {
  let credits = 0;
  let quality = 0;
  for (const entry of entries) {
    const weight = entry.credits ?? 0;
    if (weight <= 0) continue;
    credits += weight;
    quality += (gradePointFor(entry.letter) ?? 0) * weight;
  }
  if (credits <= 0) return { gpa: null, total_credits: 0 };
  return { gpa: Math.round(quality / credits * 100) / 100, total_credits: credits };
}
function passedCourseIds(studentId, excludeSemesterId) {
  const scale = getActiveGradingScale();
  const passed = /* @__PURE__ */ new Set();
  for (const enr of D.enrollments) {
    if (enr.student_id !== studentId) continue;
    if (enr.semester_id === excludeSemesterId) continue;
    const offering = getOffering(enr.offering_id);
    if (!offering) continue;
    const { numeric, letter } = computeTermGrade(studentId, offering.id);
    if (numeric === null || !letter) continue;
    const band = scale?.bands.find((b) => b.letter === letter);
    if (band?.is_passing) passed.add(offering.course_id);
  }
  return passed;
}
function unmetPrerequisites(studentId, courseId2, semesterId) {
  const rules = D.course_prerequisites.filter((p) => p.course_id === courseId2);
  if (rules.length === 0) return [];
  const student = D.students.find((s) => s.id === studentId);
  const studentProgramId = student?.program_id ?? null;
  const applicable = rules.filter((r) => r.program_id === null || r.program_id === studentProgramId);
  if (applicable.length === 0) return [];
  const passed = passedCourseIds(studentId, semesterId);
  const issues = [];
  const record = (requiredId) => {
    if (passed.has(requiredId)) return;
    const course = getCourse(requiredId);
    issues.push({
      code: course?.code ?? "?",
      reason: "not passed"
    });
  };
  for (const rule of applicable) {
    if (rule.requirement_type === "all_program_courses") {
      D.program_courses.filter(
        (pc) => pc.program_id === rule.program_id && pc.course_id !== courseId2 && pc.is_required
      ).forEach((pc) => record(pc.course_id));
    } else if (rule.prerequisite_course_id) {
      record(rule.prerequisite_course_id);
    }
  }
  return issues;
}

// src/shared/types/enums.ts
function canonicalGender(value) {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  return key === "female" || key === "male" ? key : null;
}
var CIVIL_STATUS_ALIASES = {
  single: "Single",
  s: "Single",
  married: "Married",
  m: "Married",
  divorced: "Divorced",
  d: "Divorced",
  "widow(er)": "Widow(er)",
  widow: "Widow(er)",
  widower: "Widow(er)",
  widowed: "Widow(er)",
  w: "Widow(er)"
};
function normaliseCivilStatus(value) {
  if (value == null) return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  return CIVIL_STATUS_ALIASES[cleaned.toLowerCase()] ?? cleaned;
}

// src/shared/api/mocks/handlers/_helpers.ts
var import_msw = require("msw");
function errorResponse(status, code, message, fields) {
  return import_msw.HttpResponse.json({ error: { code, message, ...fields ? { fields } : {} } }, { status });
}
function listParamsFrom(url2) {
  const page = url2.searchParams.get("page");
  const pageSize = url2.searchParams.get("page_size");
  const params = {
    sort: url2.searchParams.get("sort"),
    search: url2.searchParams.get("search")
  };
  if (page) params.page = Number(page);
  if (pageSize) params.page_size = Number(pageSize);
  return params;
}

// src/shared/api/mocks/handlers/_nudges.ts
var nudgeLog = /* @__PURE__ */ new Map();
var NUDGE_COOLDOWN_SECONDS = 4 * 60 * 60;
function lastNudgedAt(assessmentId) {
  return nudgeLog.get(assessmentId) ?? null;
}
function recordNudge(assessmentId, now = /* @__PURE__ */ new Date()) {
  const at = now.toISOString();
  nudgeLog.set(assessmentId, at);
  return at;
}
function nudgeRetryAfter(assessmentId, now = /* @__PURE__ */ new Date()) {
  const last = nudgeLog.get(assessmentId);
  if (!last) return 0;
  const elapsed = (now.getTime() - new Date(last).getTime()) / 1e3;
  return elapsed >= NUDGE_COOLDOWN_SECONDS ? 0 : Math.ceil(NUDGE_COOLDOWN_SECONDS - elapsed);
}

// src/shared/api/mocks/handlers/students.ts
var D2 = DEMO_DATASET;
var SESSION_COOKIE = "sis_mock_session";
function sessionRole(cookies) {
  return cookies[SESSION_COOKIE] ?? "principal";
}
function currentTeacherId(role) {
  if (role !== "teacher") return null;
  return D2.teachers.find((t) => t.user_id === "user-teach-1")?.id ?? D2.teachers[0]?.id ?? null;
}
function currentStudentId(role) {
  if (role !== "student") return null;
  return D2.students.find((s) => s.user_id === "user-stu-1")?.id ?? D2.students[0]?.id ?? null;
}
function offeringRef(offering) {
  if (!offering) return null;
  const course = getCourse(offering.course_id);
  const semester = getSemester(offering.semester_id);
  return {
    id: offering.id,
    course: course ? { id: course.id, name: course.name, code: course.code, credits: course.credits } : { id: offering.course_id, name: "Unknown course", code: null, credits: null },
    semester: semester ? {
      id: semester.id,
      name: semester.name,
      sequence: semester.sequence,
      is_active: semester.is_active
    } : null,
    section_code: offering.section_code,
    label: offeringLabel(offering)
  };
}
function scopedOfferingsFor(student, yearId, viewerRole) {
  const all3 = yearId ? offeringsForStudentInYear(student.id, yearId) : currentOfferingsFor(student.id);
  return narrowToLecturer(all3, viewerRole);
}
function narrowToLecturer(offerings2, viewerRole) {
  if (viewerRole !== "teacher") return offerings2;
  const teacherId = currentTeacherId(viewerRole);
  const owned = teacherId ? teacherOfferingIds(teacherId) : /* @__PURE__ */ new Set();
  return offerings2.filter((o) => owned.has(o.id));
}
function displayName(first, middle, last) {
  return [first, middle, last].filter(Boolean).join(" ");
}
function allocateStudentNumber() {
  const now = /* @__PURE__ */ new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const used = D2.students.map((s) => s.student_number).filter((n) => n.startsWith(ym) && n.length === 9).map((n) => Number(n.slice(6))).filter((n) => Number.isFinite(n));
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${ym}${String(next).padStart(3, "0")}`;
}
function studentListItem(s, viewerRole) {
  return {
    id: s.id,
    student_number: s.student_number,
    full_name: s.full_name,
    first_name: s.first_name,
    middle_name: s.middle_name,
    last_name: s.last_name,
    status: s.status,
    // The row shows the student's own level + how many courses they take. The course names
    // are a variable-length list that belongs on the detail page, not in a table cell.
    year_of_study: s.year_of_study,
    // D42 §3 — counted through the caller's own lens, mirroring `list_students`. The
    // "Courses" column is the same fact the profile's enrolment list shows, and that list
    // is scoped for a Lecturer: a global count here would print 4 in the directory and 1 on
    // the profile of the same student.
    offering_count: narrowToLecturer(currentOfferingsFor(s.id), viewerRole).length,
    guardian_name: s.guardian_name || null,
    // D32 — on the ROW as well as in the query, because the printed sheet has to show
    // what it was filtered by (brief §3).
    gender: s.gender ?? null,
    religion: s.religion ?? null,
    // D40 — added with the civil-status filter, under the same rule: a directory
    // narrowed to "Married" that never prints one cannot be checked.
    civil_status: s.civil_status ?? null,
    program_code: D2.programs.find((p) => p.id === s.program_id)?.code ?? null
  };
}
function studentDetail(s, yearId, viewerRole) {
  return {
    id: s.id,
    student_number: s.student_number,
    full_name: s.full_name,
    first_name: s.first_name,
    middle_name: s.middle_name,
    last_name: s.last_name,
    date_of_birth: s.date_of_birth,
    gender: s.gender,
    year_of_study: s.year_of_study,
    enrollment_date: s.enrollment_date,
    status: s.status,
    guardian_name: s.guardian_name,
    guardian_phone: s.guardian_phone,
    guardian_email: s.guardian_email,
    address: s.address,
    phone: s.phone,
    current_offerings: scopedOfferingsFor(s, yearId, viewerRole).map(offeringRef).filter(Boolean),
    // ── D33 (ask 4): the whole record, so the profile can show it ─────────────
    program: (() => {
      const p = D2.programs.find((x) => x.id === s.program_id);
      return p ? { id: p.id, code: p.code, name: p.name } : null;
    })(),
    // Demo mode has no `applications` link on the student row, so this is derived from
    // whether an accepted application points back at them — which is what the server's
    // `application_id` column records.
    application_id: D2.applications?.find((a) => a.student_id === s.id)?.id ?? null,
    // READ ONLY, and D34 renamed it: the student now has an `email` column of their own
    // (above), so the LOGIN needs a name that cannot be confused with it. Null for a
    // student who has no account.
    login_email: D2.users.find((u) => u.id === s.user_id)?.email ?? null,
    ssno: s.ssno,
    civil_status: s.civil_status,
    religion: s.religion,
    street: s.street,
    city_town_village: s.city_town_village,
    district: s.district,
    mother_name: s.mother_name,
    father_name: s.father_name,
    nok_name: s.nok_name,
    nok_relationship: s.nok_relationship,
    nok_phone: s.nok_phone,
    has_health_condition: s.has_health_condition,
    health_condition_note: s.health_condition_note,
    atlib_exam: s.atlib_exam,
    num_csec: s.num_csec,
    finance_name: s.finance_name,
    finance_phone: s.finance_phone,
    finance_email: s.finance_email,
    enrollment_load: s.enrollment_load,
    // ── D34 · the client's own columns ───────────────────────────────────────
    email: s.email,
    student_id_original: s.student_id_original,
    transferred_from: s.transferred_from,
    graduation_date: s.graduation_date,
    dropout_date: s.dropout_date,
    dropout_reason: s.dropout_reason,
    comments: s.comments,
    origin: s.origin,
    educationbg_id: s.educationbg_id,
    doc_id: s.doc_id
  };
}
function assessmentsForStudent(student, yearId, viewerRole) {
  const offerings2 = narrowToLecturer(
    offeringsForStudent(student.id, yearId).filter((o) => !o.is_archived),
    viewerRole
  );
  return offerings2.map((offering) => {
    const course = getCourse(offering.course_id);
    const term = computeTermGrade(student.id, offering.id);
    const assessments2 = D2.assessments.filter((a) => a.offering_id === offering.id).map((a) => assessmentLine(a, student.id));
    return {
      offering_id: offering.id,
      subject: course ? { id: course.id, name: course.name, code: course.code, credits: course.credits } : null,
      term_grade: { numeric: term.numeric, letter: term.letter },
      assessments: assessments2
    };
  });
}
function assessmentLine(a, studentId) {
  const grade = D2.assessment_grades.find(
    (g) => g.assessment_id === a.id && g.student_id === studentId
  );
  const released = grade?.is_released ?? a.is_released;
  const score = released && grade?.status === "graded" ? grade.score : null;
  return {
    id: a.id,
    title: a.title,
    type: a.type,
    max_score: a.max_score,
    weight: a.weight,
    assessment_date: a.assessment_date,
    status: grade?.status ?? "pending",
    score,
    is_released: released,
    // Read back from the demo nudge log, exactly as the real API derives it from
    // the most recent `grade.release_nudge` audit row. Drives the "Reminded 2h ago"
    // disabled state on the principal's Remind-teacher action.
    last_nudged_at: lastNudgedAt(a.id)
  };
}
function teacherOfferingIds(teacherId) {
  return new Set(offeringsOwnedByTeacher(teacherId).map((o) => o.id));
}
function resolveScopedStudent(role, id) {
  if (role === "student") {
    return { error: errorResponse(403, "forbidden", "Students read their own profile at /students/me.") };
  }
  const student = getStudent(id);
  if (!student) return { error: errorResponse(404, "not_found", "Student not found.") };
  if (role === "teacher") {
    const teacherId = currentTeacherId(role);
    const scope = teacherId ? teacherOfferingIds(teacherId) : /* @__PURE__ */ new Set();
    const shared = currentOfferingsFor(student.id).some((o) => scope.has(o.id));
    if (!shared) {
      return { error: errorResponse(404, "not_found", "Student not found.") };
    }
  }
  return { student };
}
function hasAcademicHistory(studentId) {
  return D2.assessment_grades.some((g) => g.student_id === studentId) || D2.attendance_records.some((a) => a.student_id === studentId);
}
var LIVE_STATUSES = ["Registered", "Unregistered", "transferred"];
function isDuplicateNumber(num, exceptId) {
  const q = num.trim().toLowerCase();
  return D2.students.some(
    (s) => s.id !== exceptId && LIVE_STATUSES.includes(s.status) && s.student_number.toLowerCase() === q
  );
}
function enrollStudent(student, offeringId) {
  const offering = getOffering(offeringId);
  if (!offering) return;
  const already = D2.enrollments.some(
    (e) => e.student_id === student.id && e.offering_id === offering.id && e.semester_id === offering.semester_id && !e.unenrolled_at
  );
  if (already) return;
  const enrollment = {
    id: `enr-new-${D2.enrollments.length + 1}`,
    student_id: student.id,
    offering_id: offering.id,
    semester_id: offering.semester_id,
    enrolled_at: (/* @__PURE__ */ new Date()).toISOString(),
    unenrolled_at: null,
    // D35 — registering a student enrols them ordinarily; a course status is set
    // afterwards from the offering roster.
    enrollment_status: "enrolled"
  };
  D2.enrollments.push(enrollment);
}
var studentsHandlers = [
  // ── GET /students — searchable, filterable, paginated list ──────────────────────
  import_msw2.http.get(`${API_BASE_URL}/students`, ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (role === "student") {
      return errorResponse(403, "forbidden", "Students do not have access to the roster.");
    }
    const url2 = new URL(request.url);
    const params = listParamsFrom(url2);
    const page = listStudents({
      ...params,
      status: url2.searchParams.get("status"),
      offering_id: url2.searchParams.get("offering_id"),
      year_of_study: url2.searchParams.get("year_of_study"),
      // Lecturer scope: restrict to students in offerings the lecturer teaches.
      teacher_id: role === "teacher" ? currentTeacherId(role) : null,
      // D43 — a head sees their programme's students. `demoHodStudentIds` returns []
      // for any other role, and `null` here means "no filter", so the two must not be
      // confused: an empty array for an unappointed head narrows to nothing, which is
      // the safe direction.
      student_ids: role === "hod" ? demoHodStudentIds(role) : null,
      // Per-module year switcher: restrict to students enrolled in the chosen year.
      academic_year_id: url2.searchParams.get("academic_year_id"),
      // D32 (brief §3) — the three attribute filters.
      gender: url2.searchParams.get("gender"),
      religion: url2.searchParams.get("religion"),
      civil_status: url2.searchParams.get("civil_status"),
      program_id: url2.searchParams.get("program_id")
    });
    return import_msw2.HttpResponse.json({
      ...page,
      items: page.items.map((s) => studentListItem(s, role))
    });
  }),
  /*
   * D32 — GET /students/filter-options.
   *
   * Declared BEFORE `/students/:studentId` so the literal wins; MSW matches in
   * registration order, exactly as the FastAPI route ordering note describes.
   */
  import_msw2.http.get(`${API_BASE_URL}/students/filter-options`, ({ cookies }) => {
    const role = sessionRole(cookies);
    if (!role) return errorResponse(401, "unauthenticated", "Not signed in.");
    if (role === "student") {
      return errorResponse(403, "forbidden", "Students do not have access to the roster.");
    }
    return import_msw2.HttpResponse.json({
      religions: studentReligions(),
      civil_statuses: studentCivilStatuses()
    });
  }),
  // ── GET /students/me/years — academic years the acting student was enrolled in ──
  // Backs the student-only top-bar year switcher.
  import_msw2.http.get(`${API_BASE_URL}/students/me/years`, ({ cookies }) => {
    const role = sessionRole(cookies);
    if (role !== "student") {
      return errorResponse(403, "forbidden", "Only students may read /students/me/years.");
    }
    const id = currentStudentId(role);
    const years = id ? yearsForStudent(id) : [];
    return import_msw2.HttpResponse.json({
      items: years.map((y) => ({ id: y.id, name: y.name, status: y.status }))
    });
  }),
  // ── GET /students/me — the student's own profile (student role only) ────────────
  // `?academic_year_id=` scopes `current_section` to that year, exactly as the staff
  // `/students/{id}` route below already did. It was missing here, so "My Profile" kept
  // showing the CURRENT section while every other screen followed the global switcher —
  // and the student sits in a different section each year.
  import_msw2.http.get(`${API_BASE_URL}/students/me`, ({ cookies, request }) => {
    const role = sessionRole(cookies);
    if (role !== "student") {
      return errorResponse(403, "forbidden", "Only students may read /students/me.");
    }
    const id = currentStudentId(role);
    const student = id ? getStudent(id) : void 0;
    if (!student) return errorResponse(404, "no_student_profile", "No student profile.");
    const yearId = new URL(request.url).searchParams.get("academic_year_id");
    return import_msw2.HttpResponse.json(studentDetail(student, yearId));
  }),
  // ── GET /students/{id}/years — academic years this student was enrolled in ──────
  // Backs the per-student year filter on the profile page (P/S/teacher, scope-checked).
  import_msw2.http.get(`${API_BASE_URL}/students/:studentId/years`, ({ params, cookies }) => {
    const role = sessionRole(cookies);
    const resolved = resolveScopedStudent(role, String(params.studentId));
    if ("error" in resolved) return resolved.error;
    const years = yearsForStudent(resolved.student.id).filter(
      (y) => role !== "teacher" || narrowToLecturer(offeringsForStudentInYear(resolved.student.id, y.id), role).length > 0
    );
    return import_msw2.HttpResponse.json({
      items: years.map((y) => ({ id: y.id, name: y.name, status: y.status }))
    });
  }),
  // ── GET /students/{id}/assessments — grouped assessment summary ─────────────────
  // `?academic_year_id=` scopes to the section the student had that year.
  import_msw2.http.get(`${API_BASE_URL}/students/:studentId/assessments`, ({ params, cookies, request }) => {
    const role = sessionRole(cookies);
    const resolved = resolveScopedStudent(role, String(params.studentId));
    if ("error" in resolved) return resolved.error;
    const yearId = new URL(request.url).searchParams.get("academic_year_id");
    return import_msw2.HttpResponse.json({
      items: assessmentsForStudent(resolved.student, yearId, role),
      nudge_cooldown_seconds: NUDGE_COOLDOWN_SECONDS
    });
  }),
  // ── GET /students/{id} — detail header ──────────────────────────────────────────
  // `?academic_year_id=` scopes `current_section` to that year.
  import_msw2.http.get(`${API_BASE_URL}/students/:studentId`, ({ params, cookies, request }) => {
    const role = sessionRole(cookies);
    const resolved = resolveScopedStudent(role, String(params.studentId));
    if ("error" in resolved) return resolved.error;
    const yearId = new URL(request.url).searchParams.get("academic_year_id");
    return import_msw2.HttpResponse.json(studentDetail(resolved.student, yearId, role));
  }),
  // ── POST /students — create (principal / secretary) ─────────────────────────────
  import_msw2.http.post(`${API_BASE_URL}/students`, async ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== "principal" && role !== "secretary") {
      return errorResponse(403, "forbidden", "You cannot create students.");
    }
    const body = await request.json();
    if (!body.first_name || !body.last_name || !body.date_of_birth || !body.enrollment_date) {
      return errorResponse(422, "validation_error", "Missing required fields.", {
        ...body.first_name ? {} : { first_name: ["Required."] },
        ...body.last_name ? {} : { last_name: ["Required."] },
        ...body.date_of_birth ? {} : { date_of_birth: ["Required."] },
        ...body.enrollment_date ? {} : { enrollment_date: ["Required."] }
      });
    }
    if (body.student_number && isDuplicateNumber(body.student_number)) {
      return errorResponse(409, "duplicate_student_number", "This student number is already in use.", {
        student_number: ["Already in use by a live student."]
      });
    }
    for (const offeringId of body.offering_ids ?? []) {
      const offering = getOffering(offeringId);
      if (!offering) {
        return errorResponse(404, "offering_not_found", "Offering not found.");
      }
      if (offering.is_archived) {
        return errorResponse(409, "year_archived", "That offering is archived.");
      }
    }
    const created = {
      id: `stu-new-${D2.students.length + 1}`,
      user_id: null,
      student_number: body.student_number || allocateStudentNumber(),
      first_name: body.first_name,
      middle_name: body.middle_name ?? null,
      last_name: body.last_name,
      full_name: displayName(body.first_name, body.middle_name ?? null, body.last_name),
      date_of_birth: body.date_of_birth,
      // D37 — folded onto the canonical pair, mirroring `normalise_gender`. Demo mode
      // has to carry this too: the last two times a rule lived in only one of the two
      // implementations, demo mode certified a screen the real backend refused.
      gender: canonicalGender(body.gender) ?? "female",
      // D33 — the student form IS the application form now (ask 3), so religion is one of
      // the fields it collects. The D32 note here said the opposite, and it was true then.
      religion: body.religion ?? null,
      enrollment_date: body.enrollment_date,
      status: body.status ?? "Registered",
      guardian_name: body.guardian_name ?? "",
      guardian_phone: body.guardian_phone ?? "",
      guardian_email: body.guardian_email ?? "",
      address: body.address ?? "",
      phone: body.phone ?? "",
      year_of_study: body.year_of_study ?? null,
      // D33 — assignable AT REGISTRATION (create only). Changing it later is the Dean's
      // action, because it has to move the programme history with it (§D12).
      program_id: body.program_id ?? null,
      // ── the rest of Sections A-E (D33) ──
      ssno: body.ssno ?? null,
      // D40 — folded like `gender` above, mirroring `normalise_civil_status`.
      civil_status: normaliseCivilStatus(body.civil_status),
      street: body.street ?? null,
      city_town_village: body.city_town_village ?? null,
      district: body.district ?? null,
      mother_name: body.mother_name ?? null,
      father_name: body.father_name ?? null,
      nok_name: body.nok_name ?? null,
      nok_relationship: body.nok_relationship ?? null,
      nok_phone: body.nok_phone ?? null,
      has_health_condition: body.has_health_condition ?? false,
      health_condition_note: body.health_condition_note ?? null,
      atlib_exam: body.atlib_exam ?? false,
      num_csec: body.num_csec ?? null,
      finance_name: body.finance_name ?? null,
      finance_phone: body.finance_phone ?? null,
      finance_email: body.finance_email ?? null,
      enrollment_load: body.enrollment_load ?? null,
      // ── D34 · the client's own columns ─────────────────────────────────────
      email: body.email ?? null,
      student_id_original: body.student_id_original ?? null,
      transferred_from: body.transferred_from ?? null,
      graduation_date: body.graduation_date ?? null,
      dropout_date: body.dropout_date ?? null,
      dropout_reason: body.dropout_reason ?? null,
      comments: body.comments ?? null,
      origin: body.origin ?? null,
      // Read-only on the wire (no FK, no consumer), so a create never sets them.
      educationbg_id: null,
      doc_id: null
    };
    D2.students.push(created);
    if (created.program_id) {
      D2.student_program_history.push({
        id: `sph-new-${D2.student_program_history.length + 1}`,
        student_id: created.id,
        program_id: created.program_id,
        started_at: created.enrollment_date,
        ended_at: null,
        reason: "Registered"
      });
    }
    for (const offeringId of body.offering_ids ?? []) enrollStudent(created, offeringId);
    return import_msw2.HttpResponse.json(studentDetail(created), { status: 201 });
  }),
  // ── PATCH /students/{id} — edit profile (status NOT editable here) ──────────────
  import_msw2.http.patch(`${API_BASE_URL}/students/:studentId`, async ({ params, request, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== "principal" && role !== "secretary") {
      return errorResponse(403, "forbidden", "You cannot edit students.");
    }
    const student = getStudent(String(params.studentId));
    if (!student) return errorResponse(404, "not_found", "Student not found.");
    const body = await request.json();
    if (body.student_number && isDuplicateNumber(body.student_number, student.id)) {
      return errorResponse(409, "duplicate_student_number", "This student number is already in use.", {
        student_number: ["Already in use by a live student."]
      });
    }
    if (body.student_number !== void 0) student.student_number = body.student_number;
    if (body.first_name !== void 0) student.first_name = body.first_name;
    if (body.middle_name !== void 0) student.middle_name = body.middle_name || null;
    if (body.last_name !== void 0) student.last_name = body.last_name;
    student.full_name = displayName(student.first_name, student.middle_name, student.last_name);
    if (body.date_of_birth !== void 0) student.date_of_birth = body.date_of_birth;
    if (body.gender !== void 0) {
      student.gender = canonicalGender(body.gender) ?? student.gender;
    }
    if (body.enrollment_date !== void 0) student.enrollment_date = body.enrollment_date;
    if (body.guardian_name !== void 0) student.guardian_name = body.guardian_name ?? "";
    if (body.guardian_phone !== void 0) student.guardian_phone = body.guardian_phone ?? "";
    if (body.guardian_email !== void 0) student.guardian_email = body.guardian_email ?? "";
    if (body.address !== void 0) student.address = body.address ?? "";
    if (body.phone !== void 0) student.phone = body.phone ?? "";
    if (body.year_of_study !== void 0) student.year_of_study = body.year_of_study ?? null;
    if (body.religion !== void 0) student.religion = body.religion || null;
    if (body.ssno !== void 0) student.ssno = body.ssno || null;
    if (body.civil_status !== void 0) {
      student.civil_status = normaliseCivilStatus(body.civil_status);
    }
    if (body.street !== void 0) student.street = body.street || null;
    if (body.city_town_village !== void 0) {
      student.city_town_village = body.city_town_village || null;
    }
    if (body.district !== void 0) student.district = body.district ?? null;
    if (body.mother_name !== void 0) student.mother_name = body.mother_name || null;
    if (body.father_name !== void 0) student.father_name = body.father_name || null;
    if (body.nok_name !== void 0) student.nok_name = body.nok_name || null;
    if (body.nok_relationship !== void 0) {
      student.nok_relationship = body.nok_relationship || null;
    }
    if (body.nok_phone !== void 0) student.nok_phone = body.nok_phone || null;
    if (body.has_health_condition !== void 0) {
      student.has_health_condition = Boolean(body.has_health_condition);
    }
    if (body.health_condition_note !== void 0) {
      student.health_condition_note = body.health_condition_note || null;
    }
    if (body.atlib_exam !== void 0) student.atlib_exam = Boolean(body.atlib_exam);
    if (body.num_csec !== void 0) student.num_csec = body.num_csec ?? null;
    if (body.finance_name !== void 0) student.finance_name = body.finance_name || null;
    if (body.finance_phone !== void 0) student.finance_phone = body.finance_phone || null;
    if (body.finance_email !== void 0) student.finance_email = body.finance_email || null;
    if (body.enrollment_load !== void 0) student.enrollment_load = body.enrollment_load ?? null;
    if (body.email !== void 0) student.email = body.email || null;
    if (body.student_id_original !== void 0) {
      student.student_id_original = body.student_id_original ?? null;
    }
    if (body.transferred_from !== void 0) {
      student.transferred_from = body.transferred_from || null;
    }
    if (body.graduation_date !== void 0) student.graduation_date = body.graduation_date || null;
    if (body.dropout_date !== void 0) student.dropout_date = body.dropout_date || null;
    if (body.dropout_reason !== void 0) student.dropout_reason = body.dropout_reason || null;
    if (body.comments !== void 0) student.comments = body.comments || null;
    if (body.origin !== void 0) student.origin = body.origin || null;
    return import_msw2.HttpResponse.json(studentDetail(student));
  }),
  // ── POST /students/{id}/status — lifecycle change (auditable, guarded) ──────────
  import_msw2.http.post(`${API_BASE_URL}/students/:studentId/status`, async ({ params, request, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== "principal" && role !== "secretary") {
      return errorResponse(403, "forbidden", "You cannot change student status.");
    }
    const student = getStudent(String(params.studentId));
    if (!student) return errorResponse(404, "not_found", "Student not found.");
    const body = await request.json();
    const next = body.status;
    const allowed = [
      "Registered",
      "Unregistered",
      "DropOut",
      "transferred",
      "graduated",
      "withdrawn"
    ];
    if (!next || !allowed.includes(next)) {
      return errorResponse(422, "invalid_transition", "That status change is not allowed.");
    }
    if (next === "graduated" && !student.graduation_date) {
      student.graduation_date = DEMO_TODAY;
    }
    if (next === "DropOut" && !student.dropout_date) {
      student.dropout_date = `${DEMO_TODAY}T00:00:00Z`;
    }
    student.status = next;
    return import_msw2.HttpResponse.json(studentDetail(student));
  }),
  // ── DELETE /students/{id} — soft-delete only if no academic history ─────────────
  import_msw2.http.delete(`${API_BASE_URL}/students/:studentId`, ({ params, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== "principal" && role !== "secretary") {
      return errorResponse(403, "forbidden", "You cannot delete students.");
    }
    const student = getStudent(String(params.studentId));
    if (!student) return errorResponse(404, "not_found", "Student not found.");
    if (hasAcademicHistory(student.id)) {
      return errorResponse(
        409,
        "has_academic_history",
        "This student has grades or attendance on record \u2014 deactivate instead."
      );
    }
    D2.students = D2.students.filter((s) => s.id !== student.id);
    D2.enrollments = D2.enrollments.filter((e) => e.student_id !== student.id);
    return new import_msw2.HttpResponse(null, { status: 204 });
  }),
  // ── GET /students/{id}/academic-history — DERIVED (D30 §D12, brief §27) ─────────
  // Recomputed on every call from enrolments, results, approved transfers and the
  // programme curriculum. Nothing is cached as truth, exactly as the server does it.
  import_msw2.http.get(`${API_BASE_URL}/students/:studentId/academic-history`, ({ params, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== "principal" && role !== "secretary") {
      return errorResponse(403, "forbidden", "You cannot view academic history.");
    }
    const student = getStudent(String(params.studentId));
    if (!student) return errorResponse(404, "not_found", "Student not found.");
    const program = D2.programs.find((p) => p.id === student.program_id) ?? null;
    const minGradePoint = Number(program?.min_passing_grade_point ?? "2.50");
    const plan = program ? D2.program_courses.filter((pc) => pc.program_id === program.id) : [];
    const planByCourse = new Map(plan.map((pc) => [pc.course_id, pc]));
    const application = D2.applications.find((a) => a.student_id === student.id);
    const transferred = new Set(
      application ? D2.credit_transfer_requests.filter((t) => t.application_id === application.id && t.status === "approved").map((t) => t.target_course_id) : []
    );
    const enrolled = /* @__PURE__ */ new Map();
    const howSat = /* @__PURE__ */ new Map();
    for (const enr of D2.enrollments.filter((e) => e.student_id === student.id)) {
      const offering = getOffering(enr.offering_id);
      if (offering) {
        enrolled.set(offering.course_id, enr.semester_id);
        howSat.set(offering.course_id, enr.enrollment_status);
      }
    }
    const scale = getActiveGradingScale();
    const courseIds = /* @__PURE__ */ new Set([
      ...planByCourse.keys(),
      ...transferred,
      ...enrolled.keys()
    ]);
    const counts = {
      completed: 0,
      failed: 0,
      in_progress: 0,
      transferred: 0,
      remaining: 0,
      // D35 — the client's `coursestatus`.
      audited: 0,
      withdrawn: 0
    };
    let creditsEarned = 0;
    const gpaEntries = [];
    const courses2 = [];
    for (const courseId2 of courseIds) {
      const course = getCourse(courseId2);
      if (!course) continue;
      const pc = planByCourse.get(courseId2) ?? null;
      const credits = course.credits ?? 0;
      let letter = null;
      let numeric = null;
      for (const offering of D2.offerings.filter((o) => o.course_id === courseId2)) {
        const term = computeTermGrade(student.id, offering.id);
        if (term.numeric != null && (numeric == null || term.numeric > numeric)) {
          numeric = term.numeric;
          letter = term.letter;
        }
      }
      const gradePoint = gradePointFor(letter);
      let status;
      const how = howSat.get(courseId2);
      if (transferred.has(courseId2)) {
        status = "transferred";
        creditsEarned += credits;
      } else if (how === "audit") {
        status = "audited";
      } else if (how === "withdraw_passing") {
        status = "withdrawn";
      } else if (how === "withdraw_failing") {
        status = "withdrawn";
        gpaEntries.push({ credits, letter: null });
      } else if (numeric != null) {
        const band = scale?.bands.find((b) => b.letter === letter);
        const passed = gradePoint != null ? gradePoint >= minGradePoint : Boolean(band?.is_passing);
        status = passed ? "completed" : "failed";
        if (passed) creditsEarned += credits;
        gpaEntries.push({ credits, letter });
      } else if (enrolled.has(courseId2)) {
        status = "in_progress";
        gpaEntries.push({ credits, letter: null });
      } else {
        status = "remaining";
      }
      counts[status] += 1;
      courses2.push({
        course_id: course.id,
        code: course.code,
        name: course.name,
        credits: course.credits,
        term_label: pc?.term_label ?? null,
        term_order: pc?.term_order ?? null,
        is_required: pc ? pc.is_required : false,
        in_curriculum: pc !== null,
        status,
        numeric,
        letter,
        grade_point: gradePoint,
        // Demo mode has no frozen snapshots — everything is computed live.
        is_frozen: false,
        semester_id: enrolled.get(courseId2) ?? null
      });
    }
    courses2.sort((a, b) => {
      const ao = a.term_order;
      const bo = b.term_order;
      if (ao == null && bo == null) return String(a.code).localeCompare(String(b.code));
      if (ao == null) return 1;
      if (bo == null) return -1;
      return ao - bo || String(a.code).localeCompare(String(b.code));
    });
    const requiredCredits = plan.filter((pc) => pc.is_required).reduce((sum, pc) => sum + (getCourse(pc.course_id)?.credits ?? 0), 0);
    const earnedRequired = courses2.filter(
      (row) => row.is_required === true && (row.status === "completed" || row.status === "transferred")
    ).reduce((sum, row) => sum + (row.credits ?? 0), 0);
    const gpa = gpaFor(gpaEntries);
    return import_msw2.HttpResponse.json({
      student_id: student.id,
      full_name: student.full_name,
      student_number: student.student_number,
      program: program ? { id: program.id, code: program.code, name: program.name } : null,
      // A straight read now: `year_of_study` IS the enum, so there is nothing to coerce.
      year_of_study: student.year_of_study,
      enrollment_load: null,
      program_total_credits: program?.total_credits ?? null,
      curriculum_required_credits: requiredCredits,
      credits_earned: creditsEarned,
      // Against the REQUIRED plan only: electives the student chose not to take are not
      // outstanding requirements.
      credits_remaining: Math.max(requiredCredits - earnedRequired, 0),
      gpa: gpa.gpa,
      gpa_total_credits: gpa.total_credits,
      counts,
      courses: courses2,
      program_history: D2.student_program_history.filter((h) => h.student_id === student.id).sort((a, b) => a.started_at.localeCompare(b.started_at)).map((h) => {
        const p = D2.programs.find((pr) => pr.id === h.program_id);
        return {
          id: h.id,
          program: { id: h.program_id, code: p?.code ?? "", name: p?.name ?? "" },
          started_at: h.started_at,
          ended_at: h.ended_at,
          reason: h.reason,
          is_current: h.ended_at === null
        };
      }),
      active_semester_id: getActiveSemester()?.id ?? null
    });
  }),
  // ── PUT /students/{id}/program — DEAN ONLY (D30 §D12, §D14) ────────────────────
  import_msw2.http.put(`${API_BASE_URL}/students/:studentId/program`, async ({ params, request, cookies }) => {
    if (sessionRole(cookies) !== "principal") {
      return errorResponse(403, "forbidden", "Only the Dean may change a student's programme.");
    }
    const student = getStudent(String(params.studentId));
    if (!student) return errorResponse(404, "not_found", "Student not found.");
    const body = await request.json();
    const program = D2.programs.find((p) => p.id === body.program_id);
    if (!program) return errorResponse(404, "program_not_found", "Programme not found.");
    if (student.program_id === program.id) {
      return errorResponse(
        409,
        "program_unchanged",
        `This student is already registered on ${program.code}.`
      );
    }
    const effective = body.effective_from || DEMO_TODAY;
    const open = D2.student_program_history.find(
      (h) => h.student_id === student.id && h.ended_at === null
    );
    if (open) {
      if (effective < open.started_at) {
        return errorResponse(
          422,
          "validation_error",
          `The change cannot take effect before the current programme started (${open.started_at}).`,
          { effective_from: ["Earlier than the current registration."] }
        );
      }
      const dayBefore = /* @__PURE__ */ new Date(`${effective}T00:00:00`);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const closed = dayBefore.toISOString().slice(0, 10);
      open.ended_at = closed < open.started_at ? open.started_at : closed;
      open.reason = open.reason ?? body.reason ?? null;
    }
    D2.student_program_history.push({
      id: `sph-demo-${D2.student_program_history.length + 1}`,
      student_id: student.id,
      program_id: program.id,
      started_at: effective,
      ended_at: null,
      reason: body.reason ?? null
    });
    student.program_id = program.id;
    if (body.year_of_study) student.year_of_study = body.year_of_study;
    return import_msw2.HttpResponse.json({
      student_id: student.id,
      program: { id: program.id, code: program.code, name: program.name },
      year_of_study: body.year_of_study ?? null,
      enrollment_load: body.enrollment_load ?? null,
      history: D2.student_program_history.filter((h) => h.student_id === student.id).sort((a, b) => a.started_at.localeCompare(b.started_at)).map((h) => {
        const p = D2.programs.find((pr) => pr.id === h.program_id);
        return {
          id: h.id,
          program: { id: h.program_id, code: p?.code ?? "", name: p?.name ?? "" },
          started_at: h.started_at,
          ended_at: h.ended_at,
          reason: h.reason,
          is_current: h.ended_at === null
        };
      })
    });
  })
];

// src/shared/api/mocks/handlers/teachers.ts
var import_msw3 = require("msw");
var D3 = DEMO_DATASET;
var DEMO_STANDIN_TEACHER_ID = "teach-1";
function resolveTeacher(rawId) {
  const t = getTeacher(rawId);
  if (t) return t;
  return rawId === "mock-teacher-profile" ? getTeacher(DEMO_STANDIN_TEACHER_ID) : void 0;
}
function toListItem(t) {
  return {
    id: t.id,
    staff_number: t.staff_number,
    full_name: t.full_name,
    email: t.email,
    status: t.status,
    subject_specializations: t.subject_specializations,
    /** Convenience count for the directory table (#assignments). */
    assignment_count: offeringsOwnedByTeacher(t.id).length
  };
}
function toClassTaught(offering, teacherId) {
  const course = getCourse(offering.course_id);
  const semester = getSemester(offering.semester_id);
  return {
    offering_id: offering.id,
    offering: {
      id: offering.id,
      course: course ? { id: course.id, name: course.name, code: course.code, credits: course.credits } : { id: offering.course_id, name: "Unknown course", code: null, credits: null },
      semester: semester ? {
        id: semester.id,
        name: semester.name,
        sequence: semester.sequence,
        is_active: semester.is_active
      } : null,
      section_code: offering.section_code,
      label: offeringLabel(offering)
    },
    is_lead: offering.lead_teacher_id === teacherId
  };
}
function offeringsTaught(teacherId, yearId) {
  const owned = offeringsOwnedByTeacher(teacherId);
  if (!yearId) return owned;
  const inYear = new Set(offeringsForYear(yearId).map((o) => o.id));
  return owned.filter((o) => inYear.has(o.id));
}
function yearsTaughtBy(teacherId) {
  const semesterIds = new Set(offeringsOwnedByTeacher(teacherId).map((o) => o.semester_id));
  const yearIds = new Set(
    D3.semesters.filter((sem) => semesterIds.has(sem.id)).map((sem) => sem.academic_year_id)
  );
  return D3.academic_years.filter((y) => yearIds.has(y.id)).sort((a, b) => b.name.localeCompare(a.name));
}
function studentCountForTeacher(teacherId) {
  const ids = /* @__PURE__ */ new Set();
  for (const offering of offeringsOwnedByTeacher(teacherId)) {
    for (const student of rosterFor(offering.id)) ids.add(student.id);
  }
  return ids.size;
}
function toDetail(t, yearId) {
  const owned = offeringsTaught(t.id, yearId);
  return {
    id: t.id,
    user_id: t.user_id,
    staff_number: t.staff_number,
    full_name: t.full_name,
    email: t.email,
    phone: t.phone,
    status: t.status,
    subject_specializations: t.subject_specializations,
    has_login: t.user_id !== null,
    classes_taught: owned.map((off) => toClassTaught(off, t.id)),
    // D39 `015` — null until the lecturer is actually edited, mirroring the server.
    audit: { created_at: DEMO_TODAY_ISO, updated_at: t.updated_at ?? null },
    // Extended profile (optional; may be undefined for freshly created teachers).
    avatar_url: t.avatar_url,
    bio: t.bio,
    gender: t.gender,
    academic_qualification: t.academic_qualification,
    designation: t.designation,
    address: t.address,
    expertise: t.expertise,
    // Employment record (D39, Meeting #2 item 10). `is_employed` is DERIVED from status
    // here exactly as `service._sync_is_employed` derives it — the mock must not offer a
    // way for the two to disagree that the real API does not have.
    first_name: t.first_name,
    last_name: t.last_name,
    ssno: t.ssno,
    licensenum: t.licensenum,
    is_employed: t.status === "active",
    hire_date: t.hire_date ?? null,
    end_date: t.end_date ?? null,
    comments: t.comments,
    student_count: studentCountForTeacher(t.id)
  };
}
function activeAssignmentsOf(teacherId) {
  return offeringsOwnedByTeacher(teacherId).filter((o) => !o.is_archived);
}
function assignmentRefs(assignments) {
  return assignments.map((offering) => ({
    offering_id: offering.id,
    // One derived label, where this used to print `class_name` · `subject_name` — two
    // fields describing one thing.
    label: offeringLabel(offering),
    course_name: getCourse(offering.course_id)?.name ?? null
  }));
}
var teacherSeq = 100;
var teachersHandlers = [
  // GET /teachers — searchable directory (Page[TeacherListItem]). Teacher = RO; Student → 403.
  import_msw3.http.get(`${API_BASE_URL}/teachers`, ({ request, cookies }) => {
    const url2 = new URL(request.url);
    const role = cookies["sis_mock_session"] ?? "principal";
    const page = listTeachers({
      ...listParamsFrom(url2),
      status: url2.searchParams.get("status"),
      specialization: url2.searchParams.get("specialization"),
      // Per-module year switcher: restrict to teachers assigned in the chosen year.
      academic_year_id: url2.searchParams.get("academic_year_id"),
      teacher_ids: role === "hod" ? demoHodTeacherIds(role) : null
    });
    return import_msw3.HttpResponse.json({ ...page, items: page.items.map(toListItem) });
  }),
  // GET /teachers/{id}/years — the academic years this lecturer taught in (D42 §2).
  // Declared BEFORE the bare `/teachers/:teacherId` for the same reason the router
  // declares it first: a reader scanning this list should see the specific path win.
  import_msw3.http.get(`${API_BASE_URL}/teachers/:teacherId/years`, ({ params }) => {
    const teacher = resolveTeacher(String(params.teacherId));
    if (!teacher) return errorResponse(404, "not_found", "Lecturer not found.");
    return import_msw3.HttpResponse.json({
      items: yearsTaughtBy(teacher.id).map((y) => ({
        id: y.id,
        name: y.name,
        status: y.status
      }))
    });
  }),
  // GET /teachers/{id} — TeacherDetail (profile + classes_taught + audit).
  // `?academic_year_id=` scopes `classes_taught` to that year (D42 §2).
  import_msw3.http.get(`${API_BASE_URL}/teachers/:teacherId`, ({ params, request }) => {
    const teacher = resolveTeacher(String(params.teacherId));
    if (!teacher) return errorResponse(404, "not_found", "Lecturer not found.");
    const yearId = new URL(request.url).searchParams.get("academic_year_id");
    return import_msw3.HttpResponse.json(toDetail(teacher, yearId));
  }),
  // POST /teachers — create profile; optional create_login provisions a linked account
  // and returns a one-time temporary_password on the wrapper envelope.
  import_msw3.http.post(`${API_BASE_URL}/teachers`, async ({ request }) => {
    const body = await request.json();
    const staffNumber = (body.staff_number ?? "").trim();
    const fullName = (body.full_name ?? "").trim();
    if (!staffNumber || !fullName) {
      return errorResponse(422, "validation_error", "Staff number and full name are required.", {
        ...staffNumber ? {} : { staff_number: ["Required."] },
        ...fullName ? {} : { full_name: ["Required."] }
      });
    }
    if (D3.teachers.some((t) => t.staff_number.toLowerCase() === staffNumber.toLowerCase())) {
      return errorResponse(409, "duplicate_staff_number", "A lecturer with this staff number already exists.");
    }
    const email = (body.email ?? "").trim();
    if (email && D3.teachers.some((t) => t.email.toLowerCase() === email.toLowerCase())) {
      return errorResponse(409, "duplicate_email", "A lecturer with this email already exists.");
    }
    const licence = (body.licensenum ?? "").trim();
    if (licence && !/^[A-Za-z0-9-]{1,15}$/.test(licence)) {
      return errorResponse(422, "validation_error", "Some fields need attention.", {
        licensenum: ["Letters, digits and hyphens only."]
      });
    }
    teacherSeq += 1;
    const id = `teacher-new-${teacherSeq}`;
    let userId = null;
    let temporaryPassword = null;
    if (body.create_login) {
      const loginEmail = body.create_login.email.trim();
      if (D3.users.some((u) => u.email.toLowerCase() === loginEmail.toLowerCase())) {
        return errorResponse(409, "duplicate_email", "An account with this email already exists.");
      }
      teacherSeq += 1;
      userId = `user-new-${teacherSeq}`;
      temporaryPassword = `Temp-${staffNumber.replace(/\s+/g, "")}-${teacherSeq}`;
      const user = {
        id: userId,
        email: loginEmail,
        username: null,
        full_name: fullName,
        role: "teacher",
        is_active: true,
        must_change_password: true,
        last_login_at: null,
        locale: "en",
        theme: "light",
        date_format: null,
        default_page_size: 25
      };
      D3.users.push(user);
    }
    const created = {
      id,
      user_id: userId,
      staff_number: staffNumber,
      full_name: fullName,
      email,
      phone: (body.phone ?? "").trim(),
      subject_specializations: body.subject_specializations ?? [],
      status: body.status ?? "active",
      // D40 — every optional profile field, stored the way the PATCH arm stores them:
      // blank becomes `undefined`, so an untouched field reads as absent rather than as
      // an empty string the profile card would render as a mysteriously blank line.
      first_name: (body.first_name ?? "").trim() || void 0,
      last_name: (body.last_name ?? "").trim() || void 0,
      gender: body.gender ?? void 0,
      bio: (body.bio ?? "").trim() || void 0,
      academic_qualification: (body.academic_qualification ?? "").trim() || void 0,
      designation: (body.designation ?? "").trim() || void 0,
      address: (body.address ?? "").trim() || void 0,
      ssno: (body.ssno ?? "").trim() || void 0,
      licensenum: licence || void 0,
      hire_date: body.hire_date || void 0,
      end_date: body.end_date || void 0,
      comments: (body.comments ?? "").trim() || void 0,
      expertise: (body.expertise ?? []).map((e) => ({
        area: e.area.trim(),
        level: Math.max(0, Math.min(100, Math.round(e.level)))
      })).filter((e) => e.area.length > 0)
    };
    D3.teachers.push(created);
    return import_msw3.HttpResponse.json(
      { teacher: toDetail(created), temporary_password: temporaryPassword },
      { status: 201 }
    );
  }),
  // PATCH /teachers/{id} — benign profile edits (NOT status; NOT role).
  import_msw3.http.patch(`${API_BASE_URL}/teachers/:teacherId`, async ({ params, request }) => {
    const teacher = resolveTeacher(String(params.teacherId));
    if (!teacher) return errorResponse(404, "not_found", "Lecturer not found.");
    const body = await request.json();
    if (body.full_name !== void 0 && body.full_name.trim().length === 0) {
      return errorResponse(422, "validation_error", "Full name cannot be empty.", {
        full_name: ["Required."]
      });
    }
    const email = body.email?.trim();
    if (email && D3.teachers.some(
      (t) => t.id !== teacher.id && t.email.toLowerCase() === email.toLowerCase()
    )) {
      return errorResponse(409, "duplicate_email", "A lecturer with this email already exists.");
    }
    if (body.full_name !== void 0) teacher.full_name = body.full_name.trim();
    if (body.email !== void 0) teacher.email = (body.email ?? "").trim();
    if (body.phone !== void 0) teacher.phone = (body.phone ?? "").trim();
    if (body.subject_specializations !== void 0) {
      teacher.subject_specializations = body.subject_specializations ?? [];
    }
    if (body.bio !== void 0) teacher.bio = (body.bio ?? "").trim() || void 0;
    if (body.gender !== void 0) teacher.gender = body.gender ?? void 0;
    if (body.academic_qualification !== void 0)
      teacher.academic_qualification = (body.academic_qualification ?? "").trim() || void 0;
    if (body.designation !== void 0)
      teacher.designation = (body.designation ?? "").trim() || void 0;
    if (body.address !== void 0) teacher.address = (body.address ?? "").trim() || void 0;
    if (body.first_name !== void 0)
      teacher.first_name = (body.first_name ?? "").trim() || void 0;
    if (body.last_name !== void 0)
      teacher.last_name = (body.last_name ?? "").trim() || void 0;
    if (body.ssno !== void 0) teacher.ssno = (body.ssno ?? "").trim() || void 0;
    if (body.licensenum !== void 0) {
      const licence = (body.licensenum ?? "").trim();
      if (licence && !/^[A-Za-z0-9-]{1,15}$/.test(licence)) {
        return errorResponse(422, "validation_error", "Some fields need attention.", {
          licensenum: ["Letters, digits and hyphens only."]
        });
      }
      teacher.licensenum = licence || void 0;
    }
    if (body.hire_date !== void 0) teacher.hire_date = body.hire_date || void 0;
    if (body.end_date !== void 0) teacher.end_date = body.end_date || void 0;
    if (body.comments !== void 0)
      teacher.comments = (body.comments ?? "").trim() || void 0;
    teacher.updated_at = DEMO_TODAY_ISO;
    if (body.expertise !== void 0) {
      teacher.expertise = (body.expertise ?? []).map((e) => ({
        area: e.area.trim(),
        level: Math.max(0, Math.min(100, Math.round(e.level)))
      })).filter((e) => e.area.length > 0);
    }
    return import_msw3.HttpResponse.json(toDetail(teacher));
  }),
  // POST /teachers/{id}/status — activate/deactivate. Deactivating a teacher who still
  // has active assignments is blocked (409 teacher_has_active_assignments).
  import_msw3.http.post(`${API_BASE_URL}/teachers/:teacherId/status`, async ({ params, request }) => {
    const teacher = resolveTeacher(String(params.teacherId));
    if (!teacher) return errorResponse(404, "not_found", "Lecturer not found.");
    const body = await request.json();
    if (body.status === "inactive") {
      const active = activeAssignmentsOf(teacher.id);
      if (active.length > 0) {
        return errorResponse(
          409,
          "teacher_has_active_assignments",
          "This lecturer is still assigned to active offerings. Reassign those offerings before deactivating.",
          { assignments: assignmentRefs(active).map((a) => `${a.label} \xB7 ${a.course_name}`) }
        );
      }
    }
    teacher.status = body.status;
    return import_msw3.HttpResponse.json(toDetail(teacher));
  }),
  // DELETE /teachers/{id} — hard delete; blocked if assigned to any active class_subject.
  import_msw3.http.delete(`${API_BASE_URL}/teachers/:teacherId`, ({ params }) => {
    const teacher = resolveTeacher(String(params.teacherId));
    if (!teacher) return errorResponse(404, "not_found", "Lecturer not found.");
    const active = activeAssignmentsOf(teacher.id);
    if (active.length > 0) {
      return errorResponse(
        409,
        "teacher_has_active_assignments",
        "This lecturer is assigned to one or more active offerings and cannot be deleted. Reassign or deactivate those offerings first.",
        { assignments: assignmentRefs(active).map((a) => `${a.label} \xB7 ${a.course_name}`) }
      );
    }
    D3.teachers = D3.teachers.filter((t) => t.id !== teacher.id);
    return new import_msw3.HttpResponse(null, { status: 204 });
  })
];

// src/shared/api/mocks/handlers/grades.ts
var import_msw4 = require("msw");
var D4 = DEMO_DATASET;
var SESSION_COOKIE2 = "sis_mock_session";
function sessionRole2(cookies) {
  return cookies[SESSION_COOKIE2] ?? "principal";
}
function currentTeacherId2(role) {
  if (role !== "teacher") return null;
  return D4.teachers.find((t) => t.user_id === "user-teach-1")?.id ?? D4.teachers[0]?.id ?? null;
}
function currentStudentId2(role) {
  if (role !== "student") return null;
  return D4.students.find((s) => s.user_id === "user-stu-1")?.id ?? D4.students[0]?.id ?? null;
}
function offeringRef2(offeringId) {
  const offering = getOffering(offeringId);
  if (!offering) return null;
  const course = getCourse(offering.course_id);
  const semester = getSemester(offering.semester_id);
  const teachers2 = offering.teacher_ids.map((id) => getTeacher(id)).filter((tt) => Boolean(tt)).map((tt) => ({ id: tt.id, full_name: tt.full_name }));
  return {
    offering: {
      id: offering.id,
      course: course ? { id: course.id, name: course.name, code: course.code, credits: course.credits } : { id: offering.course_id, name: "Unknown course", code: null, credits: null },
      semester: semester ? {
        id: semester.id,
        name: semester.name,
        sequence: semester.sequence,
        is_active: semester.is_active
      } : null,
      section_code: offering.section_code,
      label: offeringLabel(offering)
    },
    teachers: teachers2,
    lead_teacher_id: offering.lead_teacher_id
  };
}
function studentRef(studentId) {
  const s = getStudent(studentId);
  if (!s) return { id: studentId, full_name: "Unknown", student_number: "" };
  return { id: s.id, full_name: s.full_name, student_number: s.student_number };
}
function assessmentSummary(a) {
  const gradedCount = D4.assessment_grades.filter(
    (g) => g.assessment_id === a.id && g.status === "graded" && g.score != null
  ).length;
  const enteredCount = D4.assessment_grades.filter(
    (g) => g.assessment_id === a.id && g.status !== "pending"
  ).length;
  return {
    id: a.id,
    title: a.title,
    type: a.type,
    category_id: a.category_id,
    max_score: a.max_score,
    weight: a.weight,
    assessment_date: a.assessment_date,
    status: a.status,
    is_released: a.is_released,
    // Whether cells for this column are editable in the gradebook: only assessments
    // that are being graded (published/grading/graded) accept entry, never drafts.
    is_editable: a.status !== "draft",
    graded_count: gradedCount,
    entered_count: enteredCount
  };
}
function semesterRefOf(offeringId) {
  const offering = getOffering(offeringId);
  const sem = offering ? getSemester(offering.semester_id) : void 0;
  return sem ? { id: sem.id, name: sem.name, sequence: sem.sequence } : null;
}
function gradebookResponse(offeringId) {
  const gb = gradebookFor(offeringId);
  const ref = offeringRef2(offeringId);
  const categories = D4.assessment_categories.filter((c) => c.offering_id === offeringId).map((c) => ({ id: c.id, name: c.name, weight: c.weight, drop_lowest_count: c.drop_lowest_count }));
  const offering = getOffering(offeringId);
  return {
    offering: ref,
    semester: semesterRefOf(offeringId),
    assessments: gb.assessments.map(assessmentSummary),
    categories,
    rows: gb.rows.map((row) => ({
      student: studentRef(row.student.id),
      enrollment_id: row.enrollment_id,
      is_active_member: row.is_active_member,
      cells: row.cells,
      term_numeric: row.term_numeric,
      term_letter: row.term_letter
    })),
    drop_lowest_applied: (offering?.drop_lowest_count ?? 0) > 0
  };
}
function midtermFreeze() {
  const sem = getActiveSemester();
  const start = sem?.midterm_submission_start ?? null;
  const end = sem?.midterm_submission_end ?? null;
  if (!start || !end) return { frozen: false, start: null, end: null };
  const now = new Date(DEMO_TODAY_ISO).getTime();
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return { frozen: false, start, end };
  return { frozen: now >= from && now <= to, start, end };
}
var gradesHandlers = [
  // ── Offering picker (which gradebooks the caller may open) ─────────────────────
  // Lecturer → own offerings; Dean/Registrar → every live offering.
  import_msw4.http.get(`${API_BASE_URL}/grades/offerings`, ({ cookies, request }) => {
    const role = sessionRole2(cookies);
    const teacherId = currentTeacherId2(role);
    const url2 = new URL(request.url);
    const yearId = url2.searchParams.get("academic_year_id") ?? getActiveYear()?.id ?? null;
    const inYear = yearId ? offeringsForYear(yearId) : D4.offerings.filter((o) => !o.is_archived);
    const offerings2 = teacherId ? offeringsOwnedByTeacher(teacherId).filter((o) => inYear.some((y) => y.id === o.id)) : inYear;
    const items = offerings2.map((offering) => {
      const ref = offeringRef2(offering.id);
      if (!ref) return null;
      return {
        ...ref,
        assessment_count: assessmentsForOffering(offering.id).length,
        // Whether the CURRENT caller may enter grades here (they teach it).
        can_edit: role === "teacher" && teacherId != null && offering.teacher_ids.includes(teacherId)
      };
    }).filter((x) => Boolean(x)).sort(
      (a, b) => (a.offering.course.code ?? "").localeCompare(b.offering.course.code ?? "") || (a.offering.section_code ?? "").localeCompare(b.offering.section_code ?? "")
    );
    return import_msw4.HttpResponse.json({ items });
  }),
  // ── The gradebook read ─────────────────────────────────────────────────────────
  import_msw4.http.get(`${API_BASE_URL}/grades/offering/:offeringId`, ({ params, cookies }) => {
    const offeringId = String(params.offeringId);
    const offering = getOffering(offeringId);
    if (!offering) return errorResponse(404, "not_found", "Gradebook not found.");
    const role = sessionRole2(cookies);
    const teacherId = currentTeacherId2(role);
    if (role === "teacher" && teacherId != null && !offering.teacher_ids.includes(teacherId)) {
      return errorResponse(404, "not_found", "Gradebook not found.");
    }
    const body = gradebookResponse(offeringId);
    const canEdit = role === "teacher" && teacherId != null && offering.teacher_ids.includes(teacherId);
    const freeze = midtermFreeze();
    const rows = role === "teacher" ? body.rows : body.rows.map((row) => ({
      ...row,
      cells: row.cells.map((c) => ({
        ...c,
        can_request_revision: false,
        revision_blocked_reason: null
      }))
    }));
    return import_msw4.HttpResponse.json({
      ...body,
      rows,
      can_edit: canEdit,
      // D42 §5 — constants, matching the server. See the note where `gradeWindow()` was.
      grade_window_closed: false,
      grade_submission_deadline: null,
      // D33 — reported for EVERY viewer, not just the one who can write: a Registrar asked
      // "why can't the lecturer enter these?" must see the same frozen window.
      midterm_frozen: freeze.frozen,
      midterm_submission_start: freeze.start,
      midterm_submission_end: freeze.end,
      viewer_role: role
    });
  }),
  // ── Grade entry / update — the ONLY grade-write path ───────────────────────────
  import_msw4.http.put(`${API_BASE_URL}/assessments/:assessmentId/grades`, async ({ params, request, cookies }) => {
    const assessmentId = String(params.assessmentId);
    const asmt = D4.assessments.find((a) => a.id === assessmentId);
    if (!asmt) return errorResponse(404, "not_found", "Assessment not found.");
    const offering = getOffering(asmt.offering_id);
    if (!offering) return errorResponse(404, "not_found", "Offering not found.");
    const writerRole = sessionRole2(cookies);
    const writerTeacherId = currentTeacherId2(writerRole);
    if (writerRole === "teacher" && writerTeacherId != null && !offering.teacher_ids.includes(writerTeacherId)) {
      return errorResponse(403, "forbidden", "You do not teach this offering.");
    }
    if (writerRole !== "principal") {
      const freeze = midtermFreeze();
      if (freeze.frozen) {
        return errorResponse(
          409,
          "midterm_frozen",
          "The mid-session grading period is in progress, so grades for this session are frozen. Entry reopens once the period closes."
        );
      }
    }
    const payload = await request.json();
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    const activeIds = new Set(
      D4.enrollments.filter((e) => e.offering_id === offering.id && !e.unenrolled_at).map((e) => e.student_id)
    );
    const notEnrolled = [];
    const scoreOffenders = [];
    for (const entry of entries) {
      if (!activeIds.has(entry.student_id)) {
        notEnrolled.push(entry.student_id);
        continue;
      }
      if (entry.status === "graded") {
        const s = entry.score;
        if (typeof s !== "number" || Number.isNaN(s) || s < 0 || s > asmt.max_score) {
          scoreOffenders.push(entry.student_id);
        }
      }
      if (entry.makeup_score != null) {
        if (entry.status !== "absent") {
          return errorResponse(422, "makeup_not_allowed", "Makeup score applies only to an absent result.");
        }
        if (!D4.assessment_policy.allow_makeup) {
          return errorResponse(422, "makeup_not_allowed", "Makeups are disabled by the grading policy.");
        }
        if (entry.makeup_score < 0 || entry.makeup_score > asmt.max_score) {
          scoreOffenders.push(entry.student_id);
        }
      }
    }
    if (notEnrolled.length > 0) {
      return errorResponse(
        422,
        "student_not_enrolled",
        "One or more students are not actively enrolled in this offering.",
        { student_id: notEnrolled }
      );
    }
    if (scoreOffenders.length > 0) {
      return errorResponse(
        422,
        "score_exceeds_max",
        `Score must be between 0 and ${asmt.max_score}.`,
        { student_id: scoreOffenders }
      );
    }
    const updated = entries.map((entry) => {
      const existing = D4.assessment_grades.find(
        (g) => g.assessment_id === assessmentId && g.student_id === entry.student_id
      );
      const nextScore = entry.status === "graded" ? entry.score ?? null : null;
      const nextMakeup = entry.status === "absent" ? entry.makeup_score ?? null : null;
      if (existing) {
        existing.status = entry.status;
        existing.score = nextScore;
        existing.makeup_score = nextMakeup;
      } else {
        const enr = D4.enrollments.find(
          (e) => e.student_id === entry.student_id && e.offering_id === offering.id && !e.unenrolled_at
        );
        D4.assessment_grades.push({
          id: `grd-new-${assessmentId}-${entry.student_id}`,
          assessment_id: assessmentId,
          student_id: entry.student_id,
          enrollment_id: enr?.id ?? "",
          status: entry.status,
          score: nextScore,
          makeup_score: nextMakeup,
          is_released: null
        });
      }
      return {
        student_id: entry.student_id,
        status: entry.status,
        score: nextScore,
        makeup_score: nextMakeup,
        ...entry.status === "graded" && nextScore != null ? { letter: letterFor(nextScore / asmt.max_score * 100) } : {}
      };
    });
    return import_msw4.HttpResponse.json({ updated });
  }),
  // ── Release control (per-assessment; whole-column in the demo) ─────────────────
  import_msw4.http.post(`${API_BASE_URL}/assessments/:assessmentId/release`, ({ params }) => {
    const asmt = D4.assessments.find((a) => a.id === String(params.assessmentId));
    if (!asmt) return errorResponse(404, "not_found", "Assessment not found.");
    asmt.is_released = true;
    const releasedCount = D4.assessment_grades.filter((g) => g.assessment_id === asmt.id).length;
    return import_msw4.HttpResponse.json({ assessment_id: asmt.id, is_released: true, released_count: releasedCount });
  }),
  import_msw4.http.post(`${API_BASE_URL}/assessments/:assessmentId/unrelease`, ({ params }) => {
    const asmt = D4.assessments.find((a) => a.id === String(params.assessmentId));
    if (!asmt) return errorResponse(404, "not_found", "Assessment not found.");
    asmt.is_released = false;
    const releasedCount = D4.assessment_grades.filter((g) => g.assessment_id === asmt.id).length;
    return import_msw4.HttpResponse.json({ assessment_id: asmt.id, is_released: false, released_count: releasedCount });
  }),
  // ── Nudge: remind the teacher to release (principal/secretary) ─────────────────
  // Mirrors the backend's refusal order exactly (assessments/service.py::nudge_release):
  // 403 role gate → 404 unknown → 409 no_assigned_teacher → 409 nothing_awaiting_release
  // → 429 rate_limited. Getting the ORDER right matters: the UI distinguishes these.
  import_msw4.http.post(`${API_BASE_URL}/assessments/:assessmentId/nudge-release`, ({ params, cookies }) => {
    const role = sessionRole2(cookies);
    if (role !== "principal" && role !== "secretary") {
      return errorResponse(403, "forbidden", "You cannot send release reminders.");
    }
    const asmt = D4.assessments.find((a) => a.id === String(params.assessmentId));
    if (!asmt) return errorResponse(404, "not_found", "Assessment not found.");
    const nudgeOffering = getOffering(asmt.offering_id);
    const teachers2 = (nudgeOffering?.teacher_ids ?? []).map((id) => getTeacher(id)).filter((tt) => Boolean(tt)).map((tt) => ({ id: tt.id, full_name: tt.full_name }));
    if (teachers2.length === 0) {
      return errorResponse(
        409,
        "no_assigned_teacher",
        "This offering has no assigned lecturer to remind."
      );
    }
    const awaiting = D4.assessment_grades.filter(
      (g) => g.assessment_id === asmt.id && g.status === "graded" && (g.is_released === false || g.is_released == null && !asmt.is_released)
    ).length;
    if (awaiting === 0) {
      return errorResponse(
        409,
        "nothing_awaiting_release",
        "Nothing is awaiting release for this assessment."
      );
    }
    const retryAfter = nudgeRetryAfter(asmt.id);
    if (retryAfter > 0) {
      return errorResponse(
        429,
        "rate_limited",
        "This lecturer was reminded recently. Try again later.",
        { retry_after_seconds: [String(retryAfter)] }
      );
    }
    const at = recordNudge(asmt.id);
    return import_msw4.HttpResponse.json({
      assessment_id: asmt.id,
      awaiting_release_count: awaiting,
      teachers: teachers2,
      last_nudged_at: at,
      next_nudge_allowed_at: new Date(
        new Date(at).getTime() + NUDGE_COOLDOWN_SECONDS * 1e3
      ).toISOString(),
      cooldown_seconds: NUDGE_COOLDOWN_SECONDS
    });
  }),
  // ── Computed-on-read term grade(s) ─────────────────────────────────────────────
  import_msw4.http.get(`${API_BASE_URL}/grades/term`, ({ request, cookies }) => {
    const url2 = new URL(request.url);
    const scope = url2.searchParams.get("scope");
    const role = sessionRole2(cookies);
    const offeringId = url2.searchParams.get("offering_id");
    if (scope === "me" || role === "student") {
      const studentId = currentStudentId2(role) ?? url2.searchParams.get("student_id");
      if (!studentId) return errorResponse(404, "not_found", "Student not found.");
      const offerings2 = offeringsForStudent(studentId).filter((o) => !o.is_archived);
      const items = offerings2.map((offering) => {
        const term = computeTermGrade(studentId, offering.id);
        return {
          student: studentRef(studentId),
          offering: offeringRef2(offering.id),
          // The OFFERING's term, not the school's active one — the row describes work done
          // in a specific semester and may well be a past one.
          semester: semesterRefOf(offering.id),
          numeric: term.numeric,
          letter: term.letter,
          weight_base_used: term.weight_base_used,
          is_frozen: false
        };
      });
      return import_msw4.HttpResponse.json({ items });
    }
    if (offeringId) {
      const gb = gradebookFor(offeringId);
      const items = gb.rows.map((row) => ({
        student: studentRef(row.student.id),
        offering: offeringRef2(offeringId),
        semester: semesterRefOf(offeringId),
        numeric: row.term_numeric,
        letter: row.term_letter,
        is_frozen: false
      }));
      return import_msw4.HttpResponse.json({ items });
    }
    return import_msw4.HttpResponse.json({ items: [] });
  }),
  // ── Student "My Grades" (released only) ────────────────────────────────────────
  import_msw4.http.get(`${API_BASE_URL}/grades/me`, ({ cookies, request }) => {
    const role = sessionRole2(cookies);
    const studentId = currentStudentId2(role) ?? currentStudentId2("student");
    if (!studentId) return errorResponse(404, "not_found", "Student profile not found.");
    const url2 = new URL(request.url);
    const yearId = url2.searchParams.get("academic_year_id") ?? getActiveYear()?.id ?? null;
    const semesterId = url2.searchParams.get("semester_id");
    const offerings2 = offeringsForStudent(studentId, yearId);
    const bySubject = offerings2.map((offering) => {
      const ref = offeringRef2(offering.id);
      const lead = offering.lead_teacher_id ? getTeacher(offering.lead_teacher_id) : void 0;
      const asmts = assessmentsForOffering(offering.id).filter(
        (a) => !semesterId || a.semester_id === semesterId
      );
      const assessments2 = asmts.map((a) => {
        const g = D4.assessment_grades.find(
          (row) => row.assessment_id === a.id && row.student_id === studentId
        );
        const released = g?.is_released ?? a.is_released;
        if (!released) return null;
        if (!g || g.status === "pending") return null;
        return {
          assessment_id: a.id,
          title: a.title,
          type: a.type,
          max_score: a.max_score,
          assessment_date: a.assessment_date,
          status: g.status,
          score: g.status === "graded" ? g.score : null,
          ...g.status === "graded" && g.score != null ? { letter: letterFor(g.score / a.max_score * 100) } : {}
        };
      }).filter((x) => Boolean(x));
      const term = computeReleasedTermGrade(studentId, offering.id, semesterId);
      return {
        offering: ref,
        teacher: lead ? { id: lead.id, full_name: lead.full_name } : null,
        assessments: assessments2,
        term_numeric: term.numeric,
        term_letter: term.letter
      };
    });
    return import_msw4.HttpResponse.json({ student: studentRef(studentId), by_subject: bySubject });
  })
];
function computeReleasedTermGrade(studentId, offeringId, semesterId) {
  const asmts = assessmentsForOffering(offeringId).filter((a) => a.status === "graded").filter((a) => !semesterId || a.semester_id === semesterId);
  let weightedSum = 0;
  let weightBase = 0;
  for (const a of asmts) {
    const g = D4.assessment_grades.find(
      (row) => row.assessment_id === a.id && row.student_id === studentId
    );
    if (!g) continue;
    const released = g.is_released ?? a.is_released;
    if (!released) continue;
    if (g.status !== "graded" || g.score == null) continue;
    const pct = g.score / a.max_score * 100;
    weightedSum += pct * a.weight;
    weightBase += a.weight;
  }
  if (weightBase === 0) return { numeric: null, letter: null };
  const numeric = Math.round(weightedSum / weightBase * 100) / 100;
  return { numeric, letter: letterFor(numeric) };
}

// src/shared/api/mocks/handlers/offerings.ts
var import_msw5 = require("msw");
var D5 = DEMO_DATASET;
function sessionRole3(cookies) {
  return cookies["sis_mock_session"] ?? "principal";
}
function courseRef(courseId2) {
  const c = getCourse(courseId2);
  return c ? { id: c.id, name: c.name, code: c.code, credits: c.credits } : { id: courseId2, name: "Unknown course", code: null, credits: null };
}
function semesterRef(semesterId) {
  const s = getSemester(semesterId);
  return s ? { id: s.id, name: s.name, sequence: s.sequence, is_active: s.is_active } : null;
}
function teacherRef(teacherId) {
  const t = getTeacher(teacherId);
  return {
    id: teacherId,
    staff_number: t?.staff_number ?? "",
    full_name: t?.full_name ?? "Unknown lecturer"
  };
}
function studentRef2(student) {
  return {
    id: student.id,
    student_number: student.student_number,
    full_name: student.full_name
  };
}
function meetingItem(m) {
  return {
    id: m.id,
    day_of_week: m.day_of_week,
    start_time: m.start_time,
    end_time: m.end_time,
    room: m.room
  };
}
function isOverCapacity(offering, enrolled) {
  return offering.capacity != null && offering.capacity > 0 && enrolled > offering.capacity;
}
function offeringCore(offering) {
  return {
    id: offering.id,
    label: offeringLabel(offering),
    course: courseRef(offering.course_id),
    semester: semesterRef(offering.semester_id),
    section_code: offering.section_code,
    capacity: offering.capacity,
    enrolled_count: rosterFor(offering.id).length,
    is_archived: offering.is_archived,
    teachers: offering.teacher_ids.map(teacherRef),
    lead_teacher_id: offering.lead_teacher_id,
    meetings: meetingsForOffering(offering.id).map(meetingItem),
    // P/S manage everything in the demo (the SPA still hides controls for non-writers).
    actionable_by_caller: true
  };
}
function offeringListItem(offering) {
  return offeringCore(offering);
}
function offeringDetail(offering) {
  const yearId = yearIdOfOffering(offering.id);
  const year = yearId ? D5.academic_years.find((y) => y.id === yearId) : void 0;
  const enrolled = rosterFor(offering.id).length;
  return {
    ...offeringCore(offering),
    // Resolved THROUGH the semester — an offering row carries no year (D31).
    academic_year: year ? { id: year.id, name: year.name, status: year.status } : null,
    over_capacity: isOverCapacity(offering, enrolled),
    assessment_count: assessmentsForOffering(offering.id).length
  };
}
function rosterEntry(offering, student) {
  const enr = D5.enrollments.find(
    (e) => e.student_id === student.id && e.offering_id === offering.id && e.semester_id === offering.semester_id && !e.unenrolled_at
  );
  return {
    enrollment_id: enr?.id ?? `enr-${offering.id}-${student.id}`,
    student: studentRef2(student),
    enrolled_at: enr?.enrolled_at ?? "",
    unenrolled_at: enr?.unenrolled_at ?? null,
    // D35 — the client's `coursestatus`. `enrolled` when there is no row to read it from,
    // which is the same default the column carries server-side.
    enrollment_status: enr?.enrollment_status ?? "enrolled"
  };
}
function notWritable(offering) {
  if (offering.is_archived) return true;
  return yearArchived(offering);
}
function yearArchived(offering) {
  const yearId = yearIdOfOffering(offering.id);
  return D5.academic_years.find((y) => y.id === yearId)?.status === "archived";
}
var DAY_SHORT = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri" };
function slotLabel(day, start, end) {
  return `${DAY_SHORT[day] ?? `Day ${day}`} ${start.slice(0, 5)}\u2013${end.slice(0, 5)}`;
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}
function scheduleConflictsForStudent(studentId, offering) {
  const mine = meetingsForOffering(offering.id);
  if (mine.length === 0) return [];
  const student = getStudent(studentId);
  const otherOfferingIds = D5.enrollments.filter(
    (e) => e.student_id === studentId && e.semester_id === offering.semester_id && !e.unenrolled_at && e.offering_id !== offering.id
  ).map((e) => e.offering_id);
  const out = [];
  for (const otherId of otherOfferingIds) {
    const other = getOffering(otherId);
    if (!other) continue;
    const otherLabel = offeringLabel(other);
    for (const m of meetingsForOffering(otherId)) {
      for (const want of mine) {
        if (m.day_of_week !== want.day_of_week) continue;
        if (!overlaps(want.start_time, want.end_time, m.start_time, m.end_time)) continue;
        const slot = slotLabel(m.day_of_week, m.start_time, m.end_time);
        out.push({
          kind: "student",
          label: student?.full_name ?? "Student",
          with_offering_id: other.id,
          with_offering_label: otherLabel,
          day_of_week: m.day_of_week,
          start_time: m.start_time,
          end_time: m.end_time,
          message: `${student?.full_name ?? "This student"} already has ${otherLabel} at ${slot}.`
        });
      }
    }
  }
  return out;
}
function visibleOfferings(role) {
  const student = currentDemoStudent(role);
  if (student) {
    const ids = new Set(
      D5.enrollments.filter((e) => e.student_id === student.id).map((e) => e.offering_id)
    );
    return D5.offerings.filter((o) => ids.has(o.id));
  }
  const teacher = currentDemoTeacher(role);
  if (teacher) {
    const ownedIds = new Set(offeringsOwnedByTeacher(teacher.id).map((o) => o.id));
    return D5.offerings.filter((o) => ownedIds.has(o.id));
  }
  if (role === "hod") {
    const visible = /* @__PURE__ */ new Set([
      ...demoHodOfferingIds(role),
      ...currentDemoHodTeacher(role) ? offeringsOwnedByTeacher(currentDemoHodTeacher(role).id).map((o) => o.id) : []
    ]);
    return D5.offerings.filter((o) => visible.has(o.id));
  }
  return D5.offerings;
}
var offeringsHandlers = [
  // ── GET /offerings — list (Page[OfferingListItem]) ──────────────────────────────
  import_msw5.http.get(`${API_BASE_URL}/offerings`, ({ request, cookies }) => {
    const url2 = new URL(request.url);
    const role = sessionRole3(cookies);
    const yearId = url2.searchParams.get("academic_year_id") ?? getActiveYear()?.id ?? null;
    const semesterId = url2.searchParams.get("semester_id");
    const courseId2 = url2.searchParams.get("course_id");
    const search = url2.searchParams.get("search");
    let rows = visibleOfferings(role);
    if (yearId) {
      const semIds = new Set(
        D5.semesters.filter((s) => s.academic_year_id === yearId).map((s) => s.id)
      );
      rows = rows.filter((o) => semIds.has(o.semester_id));
    }
    if (semesterId) rows = rows.filter((o) => o.semester_id === semesterId);
    if (courseId2) rows = rows.filter((o) => o.course_id === courseId2);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((o) => {
        const course = getCourse(o.course_id);
        return offeringLabel(o).toLowerCase().includes(q) || (course?.code ?? "").toLowerCase().includes(q) || (course?.name ?? "").toLowerCase().includes(q);
      });
    }
    const ordered = [...rows].sort(compareOfferings);
    const page = paginate(
      ordered.map(offeringListItem),
      { ...listParamsFrom(url2), sort: void 0 }
    );
    return import_msw5.HttpResponse.json(page);
  }),
  // ── POST /offerings — schedule a course in a term (Dean/Registrar) ──────────────
  import_msw5.http.post(`${API_BASE_URL}/offerings`, async ({ request }) => {
    const body = await request.json();
    if (!body.course_id) {
      return errorResponse(422, "validation_error", "A course is required.", {
        course_id: ["Required"]
      });
    }
    const course = getCourse(body.course_id);
    if (!course) return errorResponse(404, "course_not_found", "Course not found.");
    const semesterId = body.semester_id || getActiveSemester()?.id || DEMO_IDS.activeSemesterId;
    if (!getSemester(semesterId)) {
      return errorResponse(404, "semester_not_found", "Session not found.");
    }
    const sectionCode = body.section_code?.trim() || null;
    const clash = D5.offerings.find(
      (o) => o.course_id === course.id && o.semester_id === semesterId && (o.section_code ?? "").toLowerCase() === (sectionCode ?? "").toLowerCase()
    );
    if (clash) {
      return errorResponse(
        409,
        "duplicate_offering",
        "This course is already offered in that session with the same section."
      );
    }
    const teacherIds = body.teacher_ids ?? [];
    for (const id of teacherIds) {
      if (!getTeacher(id)) return errorResponse(404, "teacher_not_found", "Lecturer not found.");
    }
    const lead = body.lead_teacher_id ?? null;
    if (lead && !teacherIds.includes(lead)) {
      return errorResponse(
        422,
        "validation_error",
        "The lead lecturer must be one of the assigned lecturers.",
        { lead_teacher_id: ["Must be one of the assigned lecturers."] }
      );
    }
    const created = {
      id: `off-new-${D5.offerings.length + 1}`,
      course_id: course.id,
      semester_id: semesterId,
      section_code: sectionCode,
      capacity: typeof body.capacity === "number" && body.capacity > 0 ? Math.floor(body.capacity) : null,
      is_archived: false,
      teacher_ids: teacherIds,
      lead_teacher_id: lead ?? teacherIds[0] ?? null,
      drop_lowest_count: 0
    };
    D5.offerings.push(created);
    (body.meetings ?? []).forEach((w, i) => {
      D5.offering_meetings.push({
        id: `mtg-new-${created.id}-${i + 1}`,
        offering_id: created.id,
        day_of_week: w.day_of_week,
        start_time: w.start_time.length === 5 ? `${w.start_time}:00` : w.start_time,
        end_time: w.end_time.length === 5 ? `${w.end_time}:00` : w.end_time,
        room: w.room?.trim() || null
      });
    });
    return import_msw5.HttpResponse.json(offeringDetail(created), { status: 201 });
  }),
  // ── GET /offerings/{id} — detail ────────────────────────────────────────────────
  import_msw5.http.get(`${API_BASE_URL}/offerings/:offeringId`, ({ params }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, "offering_not_found", "Offering not found.");
    return import_msw5.HttpResponse.json(offeringDetail(offering));
  }),
  // ── PATCH /offerings/{id} — section code · capacity · archive ───────────────────
  //
  // The course and the semester are the offering's IDENTITY and are deliberately NOT
  // patchable: changing either would silently move every assessment, grade and enrolment
  // attached to it into a different course or term.
  import_msw5.http.patch(`${API_BASE_URL}/offerings/:offeringId`, async ({ params, request, cookies }) => {
    const role = sessionRole3(cookies);
    if (role !== "principal" && role !== "secretary") {
      return errorResponse(403, "forbidden", "You cannot change this offering.");
    }
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, "offering_not_found", "Offering not found.");
    if (yearArchived(offering)) {
      return errorResponse(409, "year_archived", "This offering's year is archived.");
    }
    const body = await request.json();
    if (body.section_code !== void 0) {
      const next = body.section_code?.trim() || null;
      const clash = D5.offerings.find(
        (o) => o.id !== offering.id && o.course_id === offering.course_id && o.semester_id === offering.semester_id && (o.section_code ?? "").toLowerCase() === (next ?? "").toLowerCase()
      );
      if (clash) {
        return errorResponse(
          409,
          "duplicate_offering",
          "This course is already offered in that session with the same section."
        );
      }
      offering.section_code = next;
    }
    if (body.capacity !== void 0) {
      offering.capacity = typeof body.capacity === "number" && body.capacity > 0 ? Math.floor(body.capacity) : null;
    }
    if (body.is_archived != null) offering.is_archived = body.is_archived;
    return import_msw5.HttpResponse.json(offeringDetail(offering));
  }),
  // ── DELETE /offerings/{id} — soft delete, only while it has no history ──────────
  import_msw5.http.delete(`${API_BASE_URL}/offerings/:offeringId`, ({ params, cookies }) => {
    const role = sessionRole3(cookies);
    if (role !== "principal" && role !== "secretary") {
      return errorResponse(403, "forbidden", "You cannot delete this offering.");
    }
    const idx = D5.offerings.findIndex((o) => o.id === String(params.offeringId));
    if (idx === -1) return errorResponse(404, "offering_not_found", "Offering not found.");
    const offering = D5.offerings[idx];
    const hasHistory = assessmentsForOffering(offering.id).length > 0 || D5.attendance_records.some((a) => a.offering_id === offering.id);
    if (hasHistory) {
      return errorResponse(
        409,
        "offering_has_history",
        "This offering has academic history \u2014 archive it instead."
      );
    }
    D5.offerings.splice(idx, 1);
    for (const e of D5.enrollments) {
      if (e.offering_id === offering.id && !e.unenrolled_at) {
        e.unenrolled_at = (/* @__PURE__ */ new Date()).toISOString();
      }
    }
    return new import_msw5.HttpResponse(null, { status: 204 });
  }),
  // ── GET /offerings/{id}/meetings — the weekly schedule (FR-SCH-01) ──────────────
  import_msw5.http.get(`${API_BASE_URL}/offerings/:offeringId/meetings`, ({ params }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, "offering_not_found", "Offering not found.");
    return import_msw5.HttpResponse.json({
      meetings: meetingsForOffering(offering.id).map(meetingItem),
      conflicts: []
    });
  }),
  // ── PUT /offerings/{id}/meetings — replace the whole week (FR-SCH-02) ───────────
  //
  // Conflicts WARN, they do not block: the write always succeeds and the clashes ride back
  // in the response, matching the server (and the over-capacity precedent). A demo that
  // rejected a clashing save would teach the opposite of how the real screen behaves.
  import_msw5.http.put(`${API_BASE_URL}/offerings/:offeringId/meetings`, async ({ params, request }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, "offering_not_found", "Offering not found.");
    if (notWritable(offering)) {
      return errorResponse(409, "year_archived", "This offering belongs to an archived year.");
    }
    const body = await request.json();
    const wanted = body.meetings ?? [];
    const myTeacherIds = new Set(offering.teacher_ids);
    const conflicts = [];
    for (const other of D5.offerings) {
      if (other.id === offering.id) continue;
      if (other.semester_id !== offering.semester_id) continue;
      const otherLabel = offeringLabel(other);
      for (const m of meetingsForOffering(other.id)) {
        for (const want of wanted) {
          if (m.day_of_week !== want.day_of_week) continue;
          if (!overlaps(want.start_time, want.end_time, m.start_time, m.end_time)) continue;
          const slot = slotLabel(m.day_of_week, m.start_time, m.end_time);
          for (const tid of other.teacher_ids) {
            if (!myTeacherIds.has(tid)) continue;
            const name = getTeacher(tid)?.full_name ?? "This lecturer";
            conflicts.push({
              kind: "teacher",
              label: name,
              with_offering_id: other.id,
              with_offering_label: otherLabel,
              day_of_week: m.day_of_week,
              start_time: m.start_time,
              end_time: m.end_time,
              message: `${name} also teaches ${otherLabel} at ${slot}.`
            });
          }
          const wantRoom = (want.room ?? "").trim().toLowerCase();
          const otherRoom = (m.room ?? "").trim().toLowerCase();
          if (wantRoom && wantRoom === otherRoom) {
            conflicts.push({
              kind: "room",
              label: m.room ?? "",
              with_offering_id: other.id,
              with_offering_label: otherLabel,
              day_of_week: m.day_of_week,
              start_time: m.start_time,
              end_time: m.end_time,
              message: `${m.room} is already used by ${otherLabel} at ${slot}.`
            });
          }
        }
      }
    }
    for (let i = D5.offering_meetings.length - 1; i >= 0; i -= 1) {
      if (D5.offering_meetings[i].offering_id === offering.id) D5.offering_meetings.splice(i, 1);
    }
    wanted.forEach((w, i) => {
      D5.offering_meetings.push({
        id: `mtg-new-${offering.id}-${i + 1}`,
        offering_id: offering.id,
        day_of_week: w.day_of_week,
        // The editor submits "HH:MM"; the API serves "HH:MM:SS".
        start_time: w.start_time.length === 5 ? `${w.start_time}:00` : w.start_time,
        end_time: w.end_time.length === 5 ? `${w.end_time}:00` : w.end_time,
        room: w.room?.trim() || null
      });
    });
    return import_msw5.HttpResponse.json({
      meetings: meetingsForOffering(offering.id).map(meetingItem),
      conflicts
    });
  }),
  // ── GET /offerings/{id}/roster — active roster (RosterEntry[], not paginated) ───
  import_msw5.http.get(`${API_BASE_URL}/offerings/:offeringId/roster`, ({ params }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, "offering_not_found", "Offering not found.");
    const entries = rosterFor(offering.id).slice().sort((a, b) => a.full_name.localeCompare(b.full_name)).map((student) => rosterEntry(offering, student));
    return import_msw5.HttpResponse.json(entries);
  }),
  // ── GET /offerings/{id}/enrollable-students — picker for the enrol dialog ───────
  // Offerings-owned convenience read (the Students module owns /students). Returns active
  // students NOT already on this offering's roster, name-sorted.
  import_msw5.http.get(`${API_BASE_URL}/offerings/:offeringId/enrollable-students`, ({ params, request }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, "offering_not_found", "Offering not found.");
    const onRoster = new Set(rosterFor(offering.id).map((s) => s.id));
    const url2 = new URL(request.url);
    const search = (url2.searchParams.get("search") ?? "").toLowerCase();
    const rows = D5.students.filter((s) => s.status === "Registered" && !onRoster.has(s.id)).filter(
      (s) => !search || s.full_name.toLowerCase().includes(search) || s.student_number.toLowerCase().includes(search)
    ).slice().sort((a, b) => a.full_name.localeCompare(b.full_name)).map(studentRef2);
    return import_msw5.HttpResponse.json({ items: rows });
  }),
  // ── POST /offerings/{id}/enrollments — enrol (bulk), warn-only capacity ─────────
  //
  // Enrolling is ADDITIVE. It used to close the student's active enrollment anywhere else in
  // the semester and report it as a `transfer` — correct when a student had one homeroom,
  // and data loss the moment they legitimately take Algebra AND Biology. Both the transfer
  // and the `transferred` field are gone; `schedule_conflicts` replaces them.
  import_msw5.http.post(`${API_BASE_URL}/offerings/:offeringId/enrollments`, async ({ params, request }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, "offering_not_found", "Offering not found.");
    if (notWritable(offering)) {
      return errorResponse(409, "year_archived", "This offering belongs to an archived year.");
    }
    const body = await request.json();
    const ids = body.student_ids ?? [];
    if (body.semester_id && body.semester_id !== offering.semester_id) {
      return errorResponse(
        409,
        "semester_mismatch",
        "This offering runs in a different session."
      );
    }
    const semesterId = offering.semester_id;
    const enrolled = [];
    const schedule_conflicts = ids.flatMap(
      (studentId) => scheduleConflictsForStudent(studentId, offering)
    );
    for (const studentId of ids) {
      const unmet = unmetPrerequisites(studentId, offering.course_id, semesterId);
      if (unmet.length > 0) {
        const student = getStudent(studentId);
        const detail = unmet.map((u) => `${u.code} (${u.reason})`).join("; ");
        return errorResponse(
          409,
          "prerequisite_not_met",
          `${student?.full_name ?? "This student"} has not met the prerequisites: ${detail}.`
        );
      }
    }
    for (const studentId of ids) {
      const student = getStudent(studentId);
      if (!student) return errorResponse(404, "student_not_found", "Student not found.");
      const alreadyHere = D5.enrollments.find(
        (e) => e.student_id === studentId && e.offering_id === offering.id && e.semester_id === semesterId && !e.unenrolled_at
      );
      if (!alreadyHere) {
        D5.enrollments.push({
          id: `enr-new-${D5.enrollments.length + 1}`,
          student_id: studentId,
          offering_id: offering.id,
          semester_id: semesterId,
          enrolled_at: (/* @__PURE__ */ new Date()).toISOString(),
          unenrolled_at: null,
          // D35 — the client's `coursestatus`, applied to the whole batch,
          // mirroring `offerings/service.enroll_students`.
          enrollment_status: body.enrollment_status ?? "enrolled"
        });
      }
      enrolled.push(rosterEntry(offering, student));
    }
    return import_msw5.HttpResponse.json({
      enrolled,
      over_capacity_warning: isOverCapacity(offering, rosterFor(offering.id).length),
      schedule_conflicts
    });
  }),
  // ── DELETE /offerings/{id}/enrollments/{enrollmentId} — withdraw ────────────────
  import_msw5.http.delete(
    `${API_BASE_URL}/offerings/:offeringId/enrollments/:enrollmentId`,
    ({ params }) => {
      const offering = getOffering(String(params.offeringId));
      if (!offering) return errorResponse(404, "offering_not_found", "Offering not found.");
      if (notWritable(offering)) {
        return errorResponse(409, "year_archived", "This offering belongs to an archived year.");
      }
      const enr = D5.enrollments.find((e) => e.id === params.enrollmentId);
      if (!enr) return errorResponse(404, "not_found", "Enrollment not found.");
      enr.unenrolled_at = (/* @__PURE__ */ new Date()).toISOString();
      return new import_msw5.HttpResponse(null, { status: 204 });
    }
  ),
  // ── PATCH /offerings/{id}/enrollments/{enrollmentId} — the course status (D35) ──
  //
  // NOT the DELETE above. That un-enrols and takes the student off the roster; this
  // records that they SAT the course and left, so the row stays open — the transcript has
  // to print `AU` / `W/P` / `W/F` against it, and deleting it would erase that.
  import_msw5.http.patch(
    `${API_BASE_URL}/offerings/:offeringId/enrollments/:enrollmentId`,
    async ({ params, request, cookies }) => {
      const role = sessionRole3(cookies);
      if (role !== "principal" && role !== "secretary") {
        return errorResponse(403, "forbidden", "You cannot change enrolments.");
      }
      const offering = getOffering(String(params.offeringId));
      if (!offering) return errorResponse(404, "offering_not_found", "Offering not found.");
      if (notWritable(offering)) {
        return errorResponse(409, "year_archived", "This offering belongs to an archived year.");
      }
      const enr = D5.enrollments.find((e) => e.id === params.enrollmentId);
      if (!enr) return errorResponse(404, "not_found", "Enrollment not found.");
      if (enr.unenrolled_at) {
        return errorResponse(
          409,
          "enrollment_closed",
          "This student is no longer enrolled in the offering, so their course status cannot be set. Re-enrol them first."
        );
      }
      const body = await request.json();
      const next = body.enrollment_status;
      const allowed = [
        "enrolled",
        "audit",
        "withdraw_passing",
        "withdraw_failing"
      ];
      if (!next || !allowed.includes(next)) {
        return errorResponse(422, "validation_error", "Unknown course status.", {
          enrollment_status: ["Must be enrolled, audit, withdraw_passing or withdraw_failing."]
        });
      }
      enr.enrollment_status = next;
      const student = D5.students.find((s) => s.id === enr.student_id);
      if (!student) return errorResponse(404, "not_found", "Student not found.");
      return import_msw5.HttpResponse.json(rosterEntry(offering, student));
    }
  ),
  // ── PUT /offerings/{id}/teachers — set the lecturer(s) ─────────────────────────
  //
  // One id, no homeroom hop. The predecessor was
  // `PUT /classes/{id}/subjects/{csId}/teachers`, threading two ids to reach one gradebook's
  // lecturers, because owning one subject of a section was a different question from owning
  // the section. One course per offering makes those the same question.
  import_msw5.http.put(`${API_BASE_URL}/offerings/:offeringId/teachers`, async ({ params, request }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, "offering_not_found", "Offering not found.");
    if (notWritable(offering)) {
      return errorResponse(409, "year_archived", "This offering belongs to an archived year.");
    }
    const body = await request.json();
    const teacherIds = body.teacher_ids ?? [];
    for (const id of teacherIds) {
      if (!getTeacher(id)) return errorResponse(404, "teacher_not_found", "Lecturer not found.");
    }
    const lead = body.lead_teacher_id ?? null;
    if (lead && !teacherIds.includes(lead)) {
      return errorResponse(
        422,
        "validation_error",
        "The lead lecturer must be one of the assigned lecturers.",
        { lead_teacher_id: ["Must be one of the assigned lecturers."] }
      );
    }
    offering.teacher_ids = teacherIds;
    offering.lead_teacher_id = lead ?? teacherIds[0] ?? null;
    return import_msw5.HttpResponse.json(offeringDetail(offering));
  }),
  // ── GET|POST /offerings/{id}/categories — assessment weighting groups ──────────
  //
  // Re-pathed from `/classes/{class_id}/subjects/{cs_id}/categories`, which threaded a
  // homeroom id AND a class_subject id to reach ONE gradebook's categories.
  import_msw5.http.get(`${API_BASE_URL}/offerings/:offeringId/categories`, ({ params }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, "offering_not_found", "Offering not found.");
    const items = D5.assessment_categories.filter((c) => c.offering_id === offering.id);
    return import_msw5.HttpResponse.json({ items });
  }),
  import_msw5.http.post(`${API_BASE_URL}/offerings/:offeringId/categories`, async ({ params, request }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, "offering_not_found", "Offering not found.");
    const body = await request.json();
    if (!body.name?.trim()) {
      return errorResponse(422, "validation_error", "A category name is required.", {
        name: ["Required"]
      });
    }
    const created = {
      id: `cat-new-${D5.assessment_categories.length + 1}`,
      offering_id: offering.id,
      name: body.name.trim(),
      weight: body.weight ?? 1,
      drop_lowest_count: body.drop_lowest_count ?? 0
    };
    D5.assessment_categories.push(created);
    return import_msw5.HttpResponse.json(created, { status: 201 });
  }),
  import_msw5.http.patch(
    `${API_BASE_URL}/offerings/:offeringId/categories/:categoryId`,
    async ({ params, request }) => {
      const offering = getOffering(String(params.offeringId));
      if (!offering) return errorResponse(404, "offering_not_found", "Offering not found.");
      const category = D5.assessment_categories.find(
        (c) => c.id === String(params.categoryId) && c.offering_id === offering.id
      );
      if (!category) return errorResponse(404, "not_found", "Category not found.");
      const body = await request.json();
      if (body.name !== void 0 && body.name.trim()) category.name = body.name.trim();
      if (body.weight !== void 0) category.weight = body.weight;
      if (body.drop_lowest_count !== void 0) {
        category.drop_lowest_count = body.drop_lowest_count;
      }
      return import_msw5.HttpResponse.json(category);
    }
  ),
  import_msw5.http.delete(`${API_BASE_URL}/offerings/:offeringId/categories/:categoryId`, ({ params }) => {
    const offering = getOffering(String(params.offeringId));
    if (!offering) return errorResponse(404, "offering_not_found", "Offering not found.");
    const idx = D5.assessment_categories.findIndex(
      (c) => c.id === String(params.categoryId) && c.offering_id === offering.id
    );
    if (idx === -1) return errorResponse(404, "not_found", "Category not found.");
    const category = D5.assessment_categories[idx];
    if (D5.assessments.some((a) => a.category_id === category.id)) {
      return errorResponse(
        409,
        "category_in_use",
        "Assessments are grouped under this category. Move them first."
      );
    }
    D5.assessment_categories.splice(idx, 1);
    return new import_msw5.HttpResponse(null, { status: 204 });
  })
];
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEMO_DATASET,
  DEMO_TODAY_ISO,
  gradesHandlers,
  offeringsHandlers,
  offeringsOwnedByTeacher,
  studentsHandlers,
  teachersHandlers
});
/*! Bundled license information:

mime-db/index.js:
  (*!
   * mime-db
   * Copyright(c) 2014 Jonathan Ong
   * Copyright(c) 2015-2022 Douglas Christopher Wilson
   * MIT Licensed
   *)

mime-types/index.js:
  (*!
   * mime-types
   * Copyright(c) 2014 Jonathan Ong
   * Copyright(c) 2015 Douglas Christopher Wilson
   * MIT Licensed
   *)
*/

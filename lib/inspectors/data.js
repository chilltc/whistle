var util = require('../util');
var Transform = require('pipestream').Transform;
var EventEmitter = require('events').EventEmitter;
var KEYS = ['statusCode', 'httpVersion', 'headers', 'trailers', 'hostname', 'path',
            'method', 'httpVersionMajo', 'httpVersionMino', 'upgrade', 'realUrl'];

function emitDataEvents(req, res, proxy) {
	if (req.rules.filter && req.rules.filter.hide 
			|| !EventEmitter.listenerCount(proxy, 'request')) {
		delete req.headers[util.CLIENT_IP_HEAD];
		return;
	}
	util.removeUnsupportsHeaders(req.headers, true);
	
	var request = new Transform();
	var response = new Transform();
	var emitted;
	
	function emitError(obj, err) {
		if (emitted) {
			return;
		}
		emitted = true;
		util.emitError(obj, err);
	}
	
	function emitReqError(err) {
		request.host = req.hostIp;
		emitError(request, err || new Error('unkown'));
	}
	
	function emitResError(err) {
		request.host = req.hostIp;
		emitError(response, err || new Error('unkown'));
	}
	
	req.on('error', emitReqError);
	
	res.on('src', function(_res) {
		_res.on('error', emitResError);
	}).on('error', emitResError);
	
	req.append(request, {pipeError: false});
	res.append(response, {pipeError: false});
	
	KEYS.forEach(function(key) {
		request[key] = req[key];
	});
	request.host = req.hostIp;
	request.ip = util.getClientIp(req);
	delete req.headers[util.CLIENT_IP_HEAD];
	request.isWhistleHttps = req.isWhistleHttps;
	request.url = util.getFullUrl(req);
	request.rules = req.rules;
	request.customHost = req.customHost,
	proxy.emit('request', request);
	
	req.on('dest', function() {
		request.host = req.hostIp;
		request.realUrl = req.realUrl;
		request.dnsTime = req.dnsTime;
		request.customHost = req.customHost,
		request.emit('send');
	});
	
	res.on('src', function() {
		KEYS.forEach(function(key) {
			response[key] = res[key];
		});
		request.realUrl = req.realUrl;
		request.host = req.hostIp || '127.0.0.1';
		request.emit('response', response);
	});

}

function addTimeout(req, res, timeout) {
	if (!(timeout > 0)) {
		return;
	}
	var timeoutId, responsed;
	var preReq = new Transform();
	var endReq = new Transform();
	var preRes = new Transform();
	var endRes = new Transform();
	
	preReq._transform = preRes._transform = function(chunk, encoding, callback) {
		timeoutId && clearTimeout(timeoutId);
		timeoutId = null;
		callback(null, chunk);
	};
	
	endReq._transform = endRes._transform = function(chunk, encoding, callback) {
		timeoutId && clearTimeout(timeoutId);
		if (!responsed || chunk) {
			timeoutId = setTimeout(emitTimeoutError, timeout);
		}
		
		if (!chunk) {
			responsed = true;
		}
		
		callback(null, chunk);
	};
	
	function emitTimeoutError() {
		util.emitError(responsed ? res : req, new Error('timeout'));
	}
	
	req.prepend(preReq).append(endReq);
	res.prepend(preRes).append(endRes);
}

module.exports = function(req, res, next) {
	emitDataEvents(req, res, this);
	addTimeout(req, res, req.timeout || this.config.timeout);
	next();
};
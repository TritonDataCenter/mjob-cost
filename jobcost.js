#!/usr/bin/env node
// Copyright (c) 2013, Joyent, Inc. All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.


var computeTable = require('./billingComputeTable.json').billingTable;
var pricing = require('./pricing.json').pricing;
var stream = require('stream');
var path = require('path');
var util = require('util');


// from https://github.com/tjfontaine/node-lstream

var LineStream = function LineStream(opts) {
    if (!(this instanceof LineStream)) return new LineStream(opts);
    opts = opts || {};
    opts.objectMode = true;
    stream.Transform.call(this, opts);
    this._buff = '';
};
util.inherits(LineStream, stream.Transform);


LineStream.prototype._transform = function(chunk, encoding, done) {
    var data = this._buff + chunk.toString('utf8');
    var lines = data.split(/\r?\n|\r(?!\n)/);

    if (!data.match(/(\r?\n|\r(?!\n))$/))
        this._buff = lines.pop();
    else
        this._buff = '';

    var self = this;

    lines.forEach(function (line) {
        self._line(line);
    });

    done();
};


LineStream.prototype._flush = function(done) {
    if (this._buff) this._line(this._buff);
    done();
};


LineStream.prototype._line = function(line) {
    this.push(line);
    this.emit('line', line);
};

// end lstream


function sumPhases(jobs, jobid) {
    var gbSeconds = 0;

    function billingLookup(usage) {
        var i;
        for (i = 0; i < computeTable.length; i++) {
            if (usage.disk > computeTable[i].disk ||
                usage.memory > computeTable[i].memory) {
                continue;
            } else {
                break;
            }
        }
        return (computeTable[i].memory);
    }

    Object.keys(jobs[jobid]).forEach(function (phase) {
        var memoryGB = billingLookup(jobs[jobid][phase]) / 1024;
        var seconds = jobs[jobid][phase].seconds;
        gbSeconds += (seconds * memoryGB);
    });

    return (gbSeconds);
}


function main(jobid) {
    var lstream = new LineStream();
    var lineCount = 0;
    jobid = getJobPath(jobid);

    lstream.on('line', function onLine(line) {
        lineCount++;

        if (line === '') {
            return;
        }

        try {
            var record = JSON.parse(line, function (key, value) {
                if (key === '') {
                    return (value);
                }
                if (typeof (value) === 'string') {
                    if (isNaN(+value)) {
                        return (value);
                    } else {
                        return (+value);
                    }
                }
                return (value);
            });
        } catch (e) {
            console.warn('Error on line ' + lineCount + ': '
                + e.message);
            process.exit(1);
        }

        if (!record.jobs[jobid]) {
            console.warn('Job ' + jobid + ' not found.');
            process.exit();
        }

        var gbSeconds = sumPhases(record.jobs, jobid);
        var cost = gbSeconds * pricing.compute;

        console.log(cost);
    });

    process.stdin.pipe(lstream);
}

function getJobPath(p) {
    return (path.normalize(p).replace(/\/$/, ''));
}

if (require.main === module) {
    if (!process.argv[2]) {
        console.warn('Usage: ' + process.argv[1] + ' <jobid>');
        process.exit(1);
    }
    main(process.argv[2]);
}


var fs = require('fs');
var Spawn = require('node-spawn');
var _ = require('underscore');
var socket = require('socket.io-client')('http://fruitiex.org:9191');
var one = require('onecolor');

// maximum values observed in a while
var bands = {
    bass: {
        minBin: 4,
        maxBin: 8,
        value: 0,
        peak: 0,
        peakBin: 0
    },
    snare: {
        minBin: 9,
        maxBin: 20,
        value: 0,
        peak: 0,
        peakBin: 0
    },
    hihat: {
        minBin: 21,
        maxBin: 1800,
        value: 0,
        peak: 0,
        peakBin: 0
    }
}
var dPeak = 0.9975;

var audioBuffer = new Buffer(0);
var windowSize = 4096;
var avgFactor = 0.85;
var fft = require('kissfft').fft;

var hue = 0;
var avg = Array.apply(null, new Array(windowSize / 2)).map(Number.prototype.valueOf, 0);
var globalPeak = 0;

var findPeakBins = function(output) {
    globalPeak = globalPeak * dPeak;
    _.each(bands, function(band) {
        var peak = 0;
        for (var i = band.minBin; i < band.maxBin; i++) {
            if (output[i] - avg[i] > peak) {
                peak = output[i] - avg[i];
                //var binChangeAvg = 0.95;
                //band.peakBin = band.peakBin * binChangeAvg + (1 - binChangeAvg) * i;
                band.peakBin = i;
            }
            if (output[i] > globalPeak) {
                globalPeak = output[i];
            }
        }
    });
};

var avgResult = function(output) {
    var retval = [];
    _.each(output, function(band, index) {
        if (band) {
            avg[index] = avg[index] * avgFactor + band * (1 - avgFactor);
            retval[index] = avg[index];
        }
    });

    return output;
};

var printSpectrum = function(output) {
    hue += 0.0005;

    // adjust intensity by approx. kick drum frequencies
    //var intensity = getAmplitude(100, 6);
    console.log(globalPeak);
    var intensity = output[Math.round(bands.bass.peakBin)];
    bands.bass.peak = Math.max(1, Math.max(bands.bass.peak * dPeak, intensity));
    // don't let peak fall too low if there's still energy in other bands
    // TODO: tweak "/ 2"
    bands.bass.peak = Math.max(globalPeak / 2, bands.bass.peak);
    bands.bass.value = bands.bass.value * avgFactor + (1 - avgFactor) * (Math.exp(Math.pow(intensity / bands.bass.peak, 4)) - 1) / (Math.E - 1);
    bands.bass.value = Math.max(bands.bass.value, (Math.exp(Math.pow(intensity / bands.bass.peak, 4)) - 1) / (Math.E - 1));
    //bands.bass.value = (Math.exp(Math.pow(intensity / bands.bass.peak, 2)) - 1) / (Math.E - 1);
    //minVal = Math.min(minVal * (2 - dVal), intensity);
    //console.log(minVal);
    //
    intensity = output[Math.round(bands.snare.peakBin)];
    bands.snare.peak = Math.max(1, Math.max(bands.snare.peak * dPeak, intensity));
    // don't let peak fall too low if there's still energy in other bands
    bands.snare.peak = Math.max(globalPeak / 2, bands.snare.peak);
    bands.snare.value = bands.snare.value * avgFactor + (1 - avgFactor) * (Math.exp(Math.pow(intensity / bands.snare.peak, 4)) - 1) / (Math.E - 1);
    bands.snare.value = Math.max(bands.snare.value, (Math.exp(Math.pow(intensity / bands.snare.peak, 4)) - 1) / (Math.E - 1));

    intensity = output[Math.round(bands.hihat.peakBin)];
    bands.hihat.peak = Math.max(0.01, Math.max(bands.hihat.peak * dPeak, intensity));
    // don't let peak fall too low if there's still energy in other bands
    bands.hihat.peak = Math.max(globalPeak / 2, bands.hihat.peak);
    bands.hihat.value = bands.hihat.value * avgFactor + (1 - avgFactor) * (Math.exp(Math.pow(intensity / bands.hihat.peak, 4)) - 1) / (Math.E - 1);
    //bands.hihat.value = Math.max(bands.hihat.value, (Math.exp(Math.pow(intensity / globalPeak, 4)) - 1) / (Math.E - 1));

    //bands.bass.value = Math.max(bands.bass.value * avgFactor, bands.bass.value * 100 - 25);
    var bass = bands.bass.value
        console.log(Math.floor(bands.bass.value * 100) + '\t'
                + Math.floor(bands.snare.value * 100) + '\t'
                + Math.floor(bands.hihat.value * 100) + '\t'
                + Math.round(bands.bass.peakBin) + '\t'
                + Math.round(bands.snare.peakBin) + '\t'
                + Math.round(bands.hihat.peakBin));
    //socket.emit('color', 'hsl(' + Math.round(hue) + ', 100%, ' + Math.round(((intensity - minVal) / (imaxVal - minVal)) * 50) + '%)');
    //var colorBass = onecolor.color('hsl(' + Math.round(hue)
    var vuColor = one('#000')
        .red(bands.bass.value)
        .blue(bands.snare.value)
        //.green(bands.hihat.value)
        .hue(hue
            //+ (bands.bass.peakBin + bands.snare.peakBin + bands.hihat.peakBin) / 10000
            , true);
    socket.emit('color', vuColor.css());
};

var runFFT = function(newData) {
    audioBuffer = Buffer.concat([audioBuffer, newData]);

    if (audioBuffer.length < windowSize) {
        // too little data, try again next time
        console.log('too little data');
        return;
    }

    audioBuffer = audioBuffer.slice(audioBuffer.length - windowSize);

    var samples = [];
    for (var i = 0; i < windowSize; i+= 2) {
        var sample = audioBuffer.readInt16LE(i, true) / 32767.0;
        samples.push(sample);
    }

    var complex = [];
    _.each(samples, function(val) {
        complex.push(val, 0);
    });
    var input = new Float32Array(complex);
    var output = new Float32Array(complex.length);
    fft(input, output, function(err, outputObj) {
        var output = [];
        for (var i = 0; i < (windowSize / 2); i++) {
            var real = outputObj[(i * 2)];
            var imag = outputObj[(i * 2) + 1];
            output[i] = Math.sqrt((real * real) + (imag * imag));
        }
        /*
        output = _.map(output, function(band) {
        return 20 * Math.log10(band);
        });
        */

        var newAvg = avgResult(output);
        findPeakBins(newAvg, output);
        printSpectrum(newAvg);
    });
};

var spawn = Spawn({
    cmd: 'pacat',
    args: ['--record', '--raw', '--channels=1', '--format=s16le'],
    onStdout: runFFT
});

spawn.start();

/* global require, console, every */
/* jshint node:true */
var ARDUINO_PORT = '/dev/ttyACM0';

var Cylon = require('cylon');

var sleep = require('sleep').sleep;

var Promise = require("bluebird");

var rasp2c = require('rasp2c');

var exec = require('shelljs/global').exec;

Cylon.api('http', {
    ssl: false,
    host: '0.0.0.0',
    serveDir: '../robeaux'
});

Cylon.robot({
    name: 'cylon_magellan',

    connections: {
        joystick: {
            adaptor: 'joystick',
            devices: {
                controller: {
                    driver: 'dualshock-3'
                }
            }
        },
        loopback: {
            adaptor: 'loopback',
            devices: {
                ping: {
                    driver: 'ping'
                }
            }
        },

        servoConnection: {
            adaptor: 'raspi',

            pin: 27,
            devices: {
                servo: {
                    driver: 'servo',
                    pin: 27
                }
            }
        },

        pilotConnection: {
            adaptor: 's3pilot',
            serialPort: ARDUINO_PORT,
            devices: {
                pilot: {
                    driver: 's3pilot',
                    geometry: {
                        //"TPR": 60,
                        //"Diam": 175.01,
                        //"Base": 220.01,
                        ticksPerMeter: 240,
                        mMax: 450
                    },
                    ahrsCalibration: {
                        a_x: -2114,
                        a_y: -578,
                        a_z: 566,
                        g_x: 92,
                        g_y: -7,
                        g_z: 53
                    }
                }
            }
        },


        //TODO: Make Srf08 Cylon Device
        //i2c: {
        //    adaptor: 'firmata',
        //    port: '/dev/i2c-1',
        //    devices: {
        //        srf08: {
        //
        //        }
        //    }
        //}
    },

    work: function (my) {

        //var version = exec('node --version', {silent:true}).output;
        //console.log(version);
        my.detectI2cDevices();

        my.controller.details.leftStick = 0;
        my.controller.details.rightStick = 0;

        ['square', 'circle', 'x', 'triangle'].forEach(function (button) {
            my.controller.on(button + ':press', function () {
                console.log('Button ' + button + ' pressed. \n ROTATE!');
                //Rot
                //
                my.pilot.sendSerial({
                    "Cmd": "Rot",
                    "Rel": 90.5
                });
            });

            my.controller.on(button + ':release', function () {
                console.log('Button ' + button + ' released.');
            });
        });

        my.controller.on('left_y:move', function (pos) {
            my.controller.details.rightStick = pos;
        });

        my.controller.on('right_y:move', function (pos) {
            my.controller.details.leftStick = pos;
        });

        var idleFor = 0; //how many cycles have we been idle for?

        var angle = 90;
        var increment = 10;

        every((0.1).second(), function () {
            var leftPower = Math.floor(my.controller.details.leftStick * 100);
            var rightPower = Math.floor(my.controller.details.rightStick * 100);

            var idle = Math.abs(leftPower) < 10 && Math.abs(rightPower) < 10;
            if (idle && idleFor < 10) {
                idleFor++;
                my.setMotorPowers(0, 0);
            } else if (!idle) {
                idleFor = 0;
                my.setMotorPowers(leftPower, rightPower);
            }

        });

        every((1).second(), function () {
            my.readSrf08(function (result) {
                //FIXME: stop that
                my.pilot.details = my.pilot.details || {};
                my.pilot.details.distance = result.distance;
                my.pilot.details.lightLevel = result.lightLevel;
            });


            angle += increment;
            if ((angle <= 30) || (angle >= 150)) { increment = -increment; }
            my.servo.angle(angle);
            console.log(my.servo);
            console.log('servo angle: '+my.servo.currentAngle());
        });
    },
    setMotorPowers: function (leftPower, rightPower) {
        this.pilot.enableMotors();
        //TODO: Change this when pilot can handle ints. For now:
        //Force powers to be floating point.
        //Zero doesn't need this treatment apparently.
        if (leftPower || rightPower) {
            leftPower += 0.001;
            rightPower += 0.001;
        }
        console.log('at power L:' + leftPower + '%\tR:' + rightPower + '%');
        this.pilot.sendSerial({
            "Cmd": "Pwr",
            "M1": -rightPower,
            "M2": -leftPower
        });
    },


    commands: function () {
        var myPowerMinPromise = powerMinPromise.bind(this);
        return {
            findInMotionPowerMin: myPowerMinPromise(70, 0, 1, 1000, 'inMotion', function (lastHeading, newHeading) {
                return Math.abs(lastHeading - newHeading) < 1;
            }),
            findFromStallPowerMin: myPowerMinPromise(0, 70, 1, 1000, 'fromStall', function (lastHeading, newHeading) {
                return (typeof lastHeading !== 'undefined') && Math.abs(lastHeading - newHeading) > 1;
            })
        }
    },

    detectI2cDevices: function () {
        console.log('detecting i2c devices');
        rasp2c.detect(function (err, result) {
            if (err) {
                console.error(err);
            } else {
                console.log('detected');
                console.log(result);
            }
        });
    },
    readSrf08: function (callback) {
        //TODO: something
        var ADDRESS = '0x70';

        rasp2c.dump(ADDRESS, '0x01-0x03', function (err, result) {
            //pong . . .
            if (err) {
                console.log('Problem Reading SRF08');
                console.error(err);
            } else {
                var sobright = result[0];
                var highByte = result[1];
                var lowByte = result[2];
                var distance = (highByte << 8) + lowByte;
                if ('function' === typeof callback) {
                    callback({
                        lightLevel: sobright,
                        distance: distance
                    });
                }
            }
        });

        //address, register, value
        rasp2c.set(ADDRESS, '0x00', '0x51', function () {
            //ping . . .
        });
    }
});

function powerMinPromise(_from, to, stepSize, stepDuration, resultName, stopWhen) {
    return function () {
        //TODO: Verify pilot board is ready?
        var my = this;
        console.log('Finding Min Power (' + resultName + ')');
        var steps = toStepArray(_from, to, stepSize);

        //TODO: this is whackeroni
        if (resultName == 'fromStall') {
            for (var i = steps.length - 1; i > 1; i--) {
                steps.splice(i, 0, 0);
            }

        }
        var lastHeading, lastPower;
        var power = steps.shift();
        my.setMotorPowers.call(my, power, -power);
        return new Promise(function (resolve, reject) {
            var intervalId = setInterval(function () {
                var newHeading = my.devices.pilot.details.pose.h;
                var power = steps.shift();
                if (typeof power === 'undefined') {
                    my.setMotorPowers(0, 0);
                    clearInterval(intervalId);
                    var result = {};
                    result[resultName] = 0;
                    result['never_stopped'] = true;

                    reject(result);
                    return;
                }
                if (stopWhen(lastHeading, newHeading)) {
                    console.log('Found Min Power: ' + lastPower);
                    var result = {};
                    result[resultName] = lastPower;
                    resolve(result);
                    my.setMotorPowers(0, 0);
                    clearInterval(intervalId);
                } else {
                    my.setMotorPowers(power, -power);
                    lastHeading = newHeading;
                    lastPower = power === 0 ? lastPower : power;
                }
            }, stepDuration);
        });
    };
}

function toStepArray(_from, to, stepSize) {
    stepSize = (_from < to) ? stepSize : -stepSize;
    var stepArray = [];
    for (var i = _from; ((i <= to) && (stepSize > 0)) || ((i >= to) && (stepSize < 0)); i += stepSize) {
        stepArray.push(i);
    }
    return stepArray;
}


Cylon.start();
/* global require, console, every */
/* jshint node:true */
var ARDUINO_PORT = '/dev/ttyACM0';

var Cylon = require('cylon');

var sleep = require('sleep').sleep;

var Promise = require("bluebird");

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

        pilotConnection: {
            adaptor: 's3pilot',
            serialPort: ARDUINO_PORT,
            devices: {
                pilot: {
                    driver: 's3pilot',
					geometry: {
						"TPR"  : 60,
						"Diam" : 175.01,
						"Base" : 220.01,
						"mMax" : 450
					},
					ahrsCalibration: [ -2114, -578, 566, 92, -7, 53]
                }
            }
        }
    },

    work: function (my) {
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
            my.controller.details.leftStick = pos;
        });

        my.controller.on('right_y:move', function (pos) {
            my.controller.details.rightStick = pos;
        });

        var idleFor = 0; //how many cycles have we been idle for?

        every((0.1).second(), function () {
            var leftPower = Math.floor(my.controller.details.leftStick * 100);
            var rightPower = Math.floor(my.controller.details.rightStick * 100);

            var idle = Math.abs(leftPower) < 10 && Math.abs(rightPower) < 10;
            if (idle && idleFor < 10) {
                idleFor++;
                my.setMotorPowers(0, 0);
            } else if (!idle) {
                idleFor = 0;
                console.log('at power L:' + leftPower + '%\tR:' + rightPower+'%');
                my.setMotorPowers(leftPower, rightPower);
            }
        });
    },
    setMotorPowers: function(leftPower, rightPower) {
        this.pilot.enableMotors();
        //TODO: Change this when pilot can handle ints. For now:
        //Force powers to be floating point.
        //Zero doesn't need this treatment apparently.
        if(leftPower && rightPower) {
            leftPower += 0.001;
            rightPower += 0.001;
        }
        console.log({
            "Cmd": "Pwr",
            "M1": -rightPower,
            "M2": -leftPower
        });
        this.pilot.sendSerial({
            "Cmd": "Pwr",
            "M1": -rightPower,
            "M2": -leftPower
        });
    },
    commands: function() {
        return {
            findInMotionPowerMin: function() {
                //TODO: Verify pilot board is ready?
                var my = this;
                console.log('In Motion . . .');
                console.log(arguments);
                var powerMin;
                var steps = toStepArray(70, 0, 1);

                var lastHeading;
                var power = steps.shift();
                my.setMotorPowers(power, -power);
                return new Promise(function(resolve, reject){
                    var intervalId = setInterval(function() {
                        var newHeading = my.pilot.details.pose.h;
                        var power = steps.shift();
                        if(!power) {
                            reject({
                                msg: 'Couldn\'t determine min power. Robot failed to stop spinning?'
                            });
                        }
                        console.log('trying: '+power);
                        console.log(my.setMotorPowers);
                        if (lastHeading == newHeading) {
                            console.log('Found Min Power: '+power);
                            resolve({
                                inMotion: power
                            });
                            my.setMotorPowers(0, 0);
                            clearInterval(intervalId);
                        } else {
                            my.setMotorPowers(power, -power);
                            lastHeading = newHeading;
                        }
                    }, 1500);
                });
            },
            findFromStallPowerMin: function() {
                console.log('From Stall . . .');
                return {
                    fromStall: 5
                };
            }
        }
    }
});

function toStepArray(_from, to, stepSize) {
    stepSize = (_from < to) ? stepSize : -stepSize;
    var stepArray = [];
    console.log(_from)
    console.log(to)
    console.log(stepSize)
    for(var i = _from; ((i <= to) && (stepSize > 0)) || ((i >= to) && (stepSize < 0)); i+= stepSize) {
        console.log('    '+i);
        stepArray.push(i);
    }
    return stepArray;
}


Cylon.start();
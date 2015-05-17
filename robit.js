/*global require, console, every */
/* jshint node:true */
var ARDUINO_PORT = '/dev/ttyACM0';

var Cylon = require('cylon');

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
        },
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
            }
            if (!idle) {
                idleFor = 0;
                my.pilot.enableMotors();
                //TODO: Change this when pilot can handle ints. For now:
                //Force powers to be floating point.
                leftPower+=0.1;
                rightPower+=0.1;
                console.log('at power L:' + leftPower + '%\tR:' + rightPower+'%');

            } else {
                leftPower = 0;
                rightPower = 0;
            }
            //TODO: method for this
            var msg = {
                "Cmd": "Pwr",
                "M1": -rightPower,
                "M2": -leftPower,
            };

            if (idleFor < 10) {
                my.pilot.sendSerial(msg);
            }
        });
    }
});

Cylon.start();
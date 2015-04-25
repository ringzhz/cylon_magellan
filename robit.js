/*global require, console, every */
var ARDUINO_PORT = '/dev/ttyACM0';

//TODO: Turn this into a cylon thingamajiggy. a device? a connection?
var serialport = require('serialport');
var SerialPort = serialport.SerialPort;
try {
    var arduinoSerialPort = new SerialPort(ARDUINO_PORT, {
        baudrate: 115200,
        parser: serialport.parsers.readline('\n')
    });
    arduinoSerialPort.on('data', function (data) {
        try {
            var msg = JSON.parse(data);
            if (msg && msg.T === 'Pose') {
                console.log(data);
            }
        } catch (err) {
            //what. ever.
        }
    });
    console.log('Connected to Arduino.');
} catch (err) {
    console.log('Couldn\'t connect to Arduino on port ' +
        ARDUINO_PORT + '. Do you have permission?');
}

function sendSerial(msg) {
    arduinoSerialPort.write(JSON.stringify(msg) + '\n');
}

var motorsEnabled = false;

function enableMotors() {
    if (!motorsEnabled) {
        sendSerial({
            "Topic": "Cmd/robot1",
            "T": "Cmd",
            "Cmd": "Esc",
            "Value": 1
        });
        motorsEnabled = true;
    }
}

var Cylon = require('cylon');
Cylon.api('http', {
    ssl: false,
    host: '0.0.0.0',
    serveDir: '../robeaux'
});

Cylon.robot({
    name: 'cylon_magellan',
    INPUT: {

    },

    connections: {
        joystick: {
            adaptor: 'joystick'
        },
        loopback: {
            adaptor: 'loopback'
        }
    },

    devices: {
        controller: {
            driver: 'dualshock-3'
        },
        ping: {
            driver: 'ping'
        }
    },
    work: function (my) {
        ['square', 'circle', 'x', 'triangle'].forEach(function (button) {
            my.controller.on(button + ':press', function () {
                console.log('Button ' + button + ' pressed.');
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

        every((0.1).second(), function () {

            var leftPower = -Math.floor(my.controller.details.leftStick * 100);
            var rightPower = -Math.floor(my.controller.details.rightStick * 100);
            if (Math.abs(leftPower) > 10 || Math.abs(rightPower) > 10) {
                enableMotors();
                console.log('at power L:' + leftPower + '%\tR:' + rightPower);
            } else {
                leftPower = 0;
                rightPower = 0;
            }
            var msg = {
                "Topic": "Cmd/robot1",
                "T": "Cmd",
                "Cmd": "Power",
                "Value": leftPower
            };
            sendSerial(msg);
        });
    }
});

Cylon.start();
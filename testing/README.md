# How to test this without an actual reader

Google Chrome won't let you use a PTY without patching, and it's nice to be able to test BLE communication.
I used a cheap USB-UART which is connected to M5Stack Atom Lite running esphome using the `lite.yaml` config.
Then, run the associated Python script to present sample data.

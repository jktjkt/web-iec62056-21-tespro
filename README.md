# Reading Electricity Meters on mobile

A simple client-side web app for automatic reading of electricity meters.
You'll need either the [OP-BT](https://zenovate.tech/en/products/op-bt/) or [OP-BTS](https://zenovate.tech/en/products/op-bts/) optical heads from Tespro/Zenovate, and a smartphone which supports Web Bluetooth.
On iPhone, use [Bluefy](https://apps.apple.com/us/app/bluefy-web-ble-browser/id1492822055), on Adroid, use Chrome.

Tested with the [ZPA AM363.D.0E](https://www.premereni.cz/cs/dulezite-informace/montaz-elektromeru/prehled-instalovanych-elektromeru/am-363/) and [ZPA ZE310.DU](https://www.premereni.cz/cs/dulezite-informace/montaz-elektromeru/prehled-instalovanych-elektromeru/ze310du/) in the [PRE Distribuce area](https://eru.gov.cz/en/who-are-my-supplier-and-distributor) in Czechia.

Some meters do not report anything, e.g., a more recent [AM375.D.0E](https://www.premereni.cz/cs/dulezite-informace/montaz-elektromeru/prehled-instalovanych-elektromeru/zpa-am375/) with HAN (RS485) port and a radio interface for 15-minute remote readout.

## How to use this

![Demo](doc/2026-02-02-iPhone.webp "Running on iPhone")

Open [the website](https://jktjkt.github.io/web-iec62056-21-tespro/), connect your BLE optical probe (autobaud required), and read the meters.
If you are unhappy with the predefined list of meters, fork this and modify the list in `index.html`.

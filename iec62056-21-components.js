import { LitElement, html, css, nothing } from "./lit-all.min.js";

function hexify(buf) {
    return Array.from(buf).map((c) => (c > 15 ? '' : '0') + c.toString(16)).join(' ')
}

class _BleReader {
    constructor(port) {
        this._port = port;
    }

    async read() {
        return this._port._rx_promise;
    }

    async cancel() {
        if (this._port._rx_promise) {
            await this._port._reset_promise('cancel', '_BleReader.cancel');
        }
    }

    async releaseLock() {
    }
};

class _BleWriter {
    constructor(port) {
        this._port = port;
    }

    async write(buf) {
        while (buf.length) {
            const size = 20;
            const chunk = buf.slice(0, size);
            console.log(`BLE: >>> ${hexify(chunk)}`);
            await this._port._tx_characteristic.writeValueWithoutResponse(chunk);
            buf = buf.slice(size);
        }
    }

    async close() {
    }

    async releaseLock() {
    }
};

class _BleReadable {
    constructor(port) {
        this._reader = new _BleReader(port);
    }

    getReader() {
        return this._reader;
    }
};

class _BleWritable {
    constructor(port) {
        this._writer = new _BleWriter(port);
    }

    getWriter() {
        return this._writer;
    }
};

class BleSerial extends EventTarget {
    serviceUUID = 0x18f0;
    rxUUID = 0x2af0;
    txUUID = 0x2af1;

    _btDev = null;
    _rx_characteristic = null;
    _tx_characteristic = null;
    _rx_promise = null;
    _rx_resolve = null;
    _rx_reject = null;

    async open() {
        console.log('Requesting device...');
        const options = {
            // We cannot filter by the service UUID because the Tespro/Zenovate optical head
            // does not actually advertise that service before we've connected. So, we can either
            // allow all devices, or filter by a name prefix -- but these names are user-configurable.
            acceptAllDevices: true,
            // filters: [
            //     {namePrefix: 'OP-BT'}
            // ],
            optionalServices: [this.serviceUUID],
        };

        try {
            this._btDev = await navigator.bluetooth.requestDevice(options);
            this._btDev.addEventListener('gattserverdisconnected', () => { this._onDisconnected(); });
            console.log('BLE: Connecting...');
            let gatt = await this._btDev.gatt.connect();
            console.log('BLE: Connected, requesting services...');
            let service = await gatt.getPrimaryService(this.serviceUUID);
            console.log('BLE: requesting RX characteristics...');
            this._rx_characteristic = await service.getCharacteristic(this.rxUUID);
            console.log('BLE: starting notifications...');
            await this._rx_characteristic.startNotifications();
            // BUG: without this start-stop-start cycle, the this._onRx() would be called against the *first*
            // BleSerial instance indefinitely. Explicitly removing the event listener is not enough,
            // and neigher is using an AbortController. Unless the *first* BleSerial calls stopNotifications(),
            // that instance will keep receiving notifications about changes in that characteristic.
            // It is not enough to call stopNotifications in BlePort.close(), because that one is not called when
            // the BLE connection drops for some external reason. Also, one cannot call stopNotifications from
            // an event handler that's connected to 'gattserverdisconnected' because the WebBluetooth actively rejects
            // that when the BLE/GATT server is not connected. Yay.
            await this._rx_characteristic.stopNotifications();
            await this._rx_characteristic.startNotifications();
            console.log('BLE: RX characteristics: notifications started');
            this._rx_characteristic.addEventListener('characteristicvaluechanged', (e) => { this._onRx(e); });
            console.log('BLE: requesting TX characteristics...');
            this._tx_characteristic = await service.getCharacteristic(this.txUUID);
            this.readable = new _BleReadable(this);
            this.writable = new _BleWritable(this);
            await this._reset_promise('init', null);
            console.log('BLE: All good, connected to ' + this._btDev.name);
        } catch (error) {
            await this.close();
            throw error;
        }
    }

    async close() {
        if (this._btDev && this._btDev.gatt.connected) {
            console.log('BLE: disconnecting...')
            await this._btDev.gatt.disconnect();
            this._btDev = null;
            console.log('BLE: disconnected')
        } else {
            console.log('BLE: Already disconnected');
        }
    }

    async _reset_promise(mode, chunk) {
        if (mode == 'init') {
            // first time: nothing to do here
        } else if (mode == 'data') {
            await this._rx_resolve({value: chunk, done: false});
        } else if (mode == 'cancel') {
            // when called from .open(), _rx_resolve might be null
            if (this._rx_resolve) {
                await this._rx_resolve({value: undefined, done: true});
            }
        // } else if (mode == 'reject') {
        //     await this._rx_reject(chunk);
        } else {
            throw `BleSerial._reset_promise: invalid mode ${mode}`;
        }
        this._rx_promise = new Promise((resolve, reject) => {
            console.log('BLE: _reset_promise: iniside that promise CTOR');
            this._rx_resolve = resolve;
            this._rx_reject = reject;
        });
    }

    _onRx(event) {
        let v = event.target.value;
        let chunk = [];
        for (let i = v.byteOffset; i < v.byteLength; i++) {
            chunk.push(v.getUint8(i));
        }
        console.log(`BLE: <<< ${hexify(chunk)}`);
        this._reset_promise('data', chunk);
    }

    async _onDisconnected() {
        this._reset_promise('cancel', undefined);
        this._tx_characteristic = null;
        this._rx_characteristic = null;
        this._btDev = null;
        this.readable = null;
        this.writable = null;
        this._rx_buf = null;
        this._rx_promise = null;
        this._rx_resolve = null;
        this._rx_reject = null;
        this.dispatchEvent(new Event('disconnect'));
    }
};

class ElectricityMetersWidget extends LitElement {
    static properties = {
        error: { type: String },
        isConnected: { type: Boolean },
        currentlyReading: { type: Boolean },
        meters: { type: Array },
        storedReadings: { type: Array },
        fields: { type: Array },
    };

    constructor() {
        super();
        this.meters = [];
        this.storedReadings = Array.from(JSON.parse(window.localStorage.getItem("storedReadings") ?? "[]"));;
        this.fields = [];
        this.isConnected = false;
        this.port = null;
        this.portReader = null;
        this.portWriter = null;
        this.rxBuf = null;
    }

    static styles = css`
        div.readout-container { display: flex; flex-direction: column; gap: 1em; width: 100%; }
        div.readout-container > button, div.readout-control > button { font-size: inherit !important; }

        div.meter-table { display: flex; flex-wrap: wrap; flex-direction: row; gap: 0.3em; }
        div.one-meter { border: 1px solid black; padding: 4px; border-radius: 6px; text-align: left; }
        div.one-meter.seen { background-color: #1e1; }

        div.field-table { display: flex; flex-wrap: wrap; flex-direction: row; gap: 0.3em; }
        div.field-table.disconnected { opacity: 30%; }
        div.one-field { border: 1px solid #333; padding: 4px; border-radius: 6px; text-align: left; }
        div.one-field-error { background: #ff6633; }

        div.readout-control { display: flex; flex-wrap: wrap; flex-direction: row; gap: 0.3em; }
        div.readout-control > button { flex-grow: 1; }
    `;

    render() {
        return html`
        <div class=readout-container>
        <button @click=${this.clearStorage} ?disabled=${this.packetCount == 0}>Clear persistent storage</button>
        <!--button @click="${this.doConnectSerial}" ?disabled=${this.isConnected}>Connect via serial</button-->
        <button @click="${this.doConnectBLE}" ?disabled=${this.isConnected}>${this.isConnected ? "Connected to " + this.port._btDev.name : "Connect via BLE"}</button>
        <button @click="${this.doDisconnect}" ?disabled=${!this.isConnected}>Disconnect</button>
        <button @click="${this.downloadPackets}"">Download (${this.meters.reduce((acc, meter) => meter.data ? acc + 1 : acc, 0)} shown, ${this.storedReadings.length} stored)</button>
        <div class=readout-control>
        <button @click="${this.doReadOne}" ?disabled=${!this.isConnected || this.currentlyReading}>▶ Read </button>
        <button @click="${this.stopReading}" ?disabled=${!this.isConnected || !this.currentlyReading}>⏹ Stop</button>
        </div>
        <div class="meters-stats ${this.error ? "error" : ""}">${this.error}</div>
        <div class=meter-table>
        ${this.meters.map(meter => html`
          <div class="one-meter ${meter.data ? "seen" : ""}">${meter.prettyName ?? meter.meterId}</div>
        `)}
        </div>
        <div class="field-table${this.isConnected ? "" : " disconnected"}">
        ${this.fields.map(dataset => html`
          <div class="one-field ${dataset.error ? "one-field-error" : ""}">${dataset.error ? dataset.line : (dataset.obis + ": " + dataset.value + (dataset.unit ? " " + dataset.unit : ""))}</div>
        `)}
        </div>
        </div>
        `;
    }

    downloadPackets() {
        const blob = new Blob([JSON.stringify(this.storedReadings)], {type: 'text/json'});
        const a = document.createElement('a');
        a.setAttribute('download', `iecmeters-${new Date().toJSON()}.json`);
        a.setAttribute('href', window.URL.createObjectURL(blob));
        a.click();
    }

    async doConnectSerial() {
        this.error = "";
        this.fields = [];
        try {
            this.port = await navigator.serial.requestPort();
            await this.port.open({baudRate: 9600}); // we rely on autobaude anyway
            this.isConnected = true;
            this.port.addEventListener('disconnect', (event) => {
                this.isConnected = false;
                this.port = null;
                this.error = 'Serial port disconnected';
                console.log(this.error);
            });
        } catch (error) {
            this.isConnected = false;
            this.error = error;
            console.log(this.error);
        }
    }

    async doConnectBLE() {
        this.error = "";
        this.fields = [];
        try {
            this.port = new BleSerial();
            await this.port.open();
            this.isConnected = true;
            this.port.addEventListener('disconnect', (event) => {
                this.isConnected = false;
                this.port = null;
                this.error = 'BLE port disconnected';
                console.log(this.error);
            });
        } catch (error) {
            this.isConnected = false;
            this.error = error;
            console.log(this.error);
        }
    }

    async doDisconnect() {
        this.isConnected = false;
        this.error = "";
        await this.dropRW();
        try {
            await this.port.close();
        } catch (error) {
            this.error = error;
            console.log(this.error);
        }
        this.port = null;
    }

    async dropRW() {
        if (this.portWriter) {
            await this.portWriter.close();
        }
        if (this.portWriter) {
            this.portWriter.releaseLock();
        }
        this.portWriter = null;
        if (this.portReader) {
            await this.portReader.cancel();
        }
        if (this.portReader) {
            this.portReader.releaseLock();
        }
        this.portReader = null;
        this.currentlyReading = false;
    }

    async serial_write(buf) {
        console.log(`>>> ${hexify(buf)}`);
        return await this.portWriter.write(buf);
    }

    async* lineReader(reader) {
        this.rxBuf = [];
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            for (const c of value) {
                // console.log(`  RX 0x${c.toString(16)}`);
                this.rxBuf.push(c);
            }

            while (this.rxBuf.length) {
                const pos = this.rxBuf.findIndex((c) => c == 0x0a);
                if (pos == -1) {
                    break;
                }
                const chunk = this.rxBuf.slice(0, pos + 1);
                this.rxBuf = this.rxBuf.slice(pos + 1);
                yield chunk;
            }
        }
    }

    async serial_read_next_line(generator) {
        const {value, done} = await generator.next();
        if (done) {
            return undefined;
            // throw 'Reading interrupted';
        }
        return String.fromCharCode.apply(null, value);
    }

    async doReadOne() {
        this.error = "";
        this.currentlyReading = true;
        this.fields = [];
        this.portWriter = this.port.writable.getWriter();
        this.portReader = this.port.readable.getReader();
        const lines = this.lineReader(this.portReader);
        try {
            const init = [0x2f, 0x3f, 0x21, 0x0d, 0x0a];
            await this.serial_write(new Uint8Array(init));
            let rx = await this.serial_read_next_line(lines);
            const identification = /^\/[A-Z]{2}[A-Za-z]([A-I0-9])(\\.)*([^\/!]+)\r\n$/
            let res;
            if (!(res = identification.exec(rx))) {
                throw `Cannot identify meter: ${rx}`;
            }

            const new_baud_mode = res[1];
            const meterTypeId = res[3];
            console.log(`ID: ${meterTypeId}, new baud mode: ${new_baud_mode}`)

            this.fields = [{
                obis: 'Meter',
                value: meterTypeId,
            }];

            const readout = [0x06, 0x30, new_baud_mode.charCodeAt(0), 0x30, 0x0d, 0x0a];
            await this.serial_write(new Uint8Array(readout));

            let line = null;
            let buf = '';
            let withBcc = false;
            let meterId = null;
            while (line = await this.serial_read_next_line(lines)) {
                if (buf == '' && line.charCodeAt(0) == 0x02) {
                    withBcc = true;
                    buf += line;
                    line = line.substring(1);
                } else {
                    buf += line;
                }
                if (line == '!\r\n') {
                    break;
                }

                let dataset = {};
                // The regex for "unit" is relaxed compared to the standard; the standard forbids slashes,
                // but our meter happily says "imp/kwh". Yay.
                // const dataset_re = /^([^()?!]{0,16})\(([^()*\/!]{0,32})(\*([^()!]{0,16}))?\)\r\n$/;
                const dataset_re = /^([^()?!]{0,16})\(([^()*\/!]{0,32})(\*([^()!/]{0,16}))?\)\r\n$/;
                if (!(res = dataset_re.exec(line))) {
                    console.log(`!!! Cannot parse dataset line ${line}`);
                    dataset = {
                        error: true,
                        line: line,
                    };
                } else {
                    dataset = {
                        obis: res[1],
                        value: res[2],
                        unit: res[4],
                    };
                    if (meterId === null && res[1] == '0.0.0') {
                        meterId = res[2];
                    }
                    if (meterId === null && res[1] == '0.0') {
                        meterId = res[2];
                    }
                }

                this.fields = [...this.fields, dataset];
            }
            if (withBcc) {
                while (this.rxBuf.length < 2) {
                    const { value, done } = await this.portReader.read();
                    if (done) {
                        break;
                    }
                    for (const c of value) {
                        this.rxBuf.push(c);
                    }
                }
                buf += String.fromCharCode.apply(null, this.rxBuf);
                let dataBcc = buf.charCodeAt(buf.length - 1);
                let calculatedBcc = 0;
                for (let i = 1; i < buf.length - 1; i++) {
                    let x = buf.charCodeAt(i) & 0x7f;
                    calculatedBcc ^= x;
                    calculatedBcc &= 0x7f;
                }
                if (dataBcc != calculatedBcc) {
                    const msg = `Checksum error: BCC from meter 0x${dataBcc.toString(16)}, calculated 0x${calculatedBcc.toString(16)}`
                    this.fields = [{
                        error: true,
                        line: msg,
                    }, ...this.fields];
                    throw msg;
                }
                this.fields = [{
                    obis: 'Checksum',
                    value: 'STX/ETX/BCC OK',
                }, ...this.fields];
            } else {
                this.fields = [{
                    obis: 'Checksum',
                    value: 'None',
                }, ...this.fields];
            }
            this.gotMeterData(meterId, {
                time: new Date().toJSON().json,
                meterType: meterTypeId,
                meterId: meterId,
                data: this.fields,
            });
        } catch (error) {
            this.error = error;
            console.log(this.error);
        } finally {
            await this.dropRW();
            await lines;
        }
    }

    async stopReading() {
        await this.dropRW();
        this.fields = [];
    }

    gotMeterData(meterId, data) {
        let meter = null;
        if (meter = this.meters.find((r) => r.meterId == meterId)) {
            meter.data = data;
        } else if (meterId) {
            this.meters = [...this.meters, {meterId: meterId, prettyName: null, data: data}];
        }
        this.storedReadings.push(data);
        window.localStorage.setItem("storedReadings", JSON.stringify(this.storedReadings));
    }

    addKnownMeter(meterId, prettyName) {
        if (!this.meters.find((r) => r.prettyName == prettyName)) {
            this.meters = [...this.meters, {meterId: meterId, prettyName: prettyName, data: null}];
        }
    }

    clearStorage() {
        if (window.confirm("Delete all captured readings? This cannot be undone.")) {
            window.localStorage.removeItem("storedReadings");
            this.storedReadings = [];
            this.fields = [];
            this.meters.forEach((meter, i) => {
                if (meter.prettyName === null) {
                    this.meters.splice(i, 1);
                }
                meter.data = null;
            });
        }
    }
}

customElements.define('iec62056-21-widget', ElectricityMetersWidget);


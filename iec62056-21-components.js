import { LitElement, html, css, nothing } from "./lit-all.min.js";

function hexify(buf) {
    return Array.from(buf).map((c) => (c > 15 ? '' : '0') + c.toString(16)).join(' ')
}

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
        div.readout-container > button { font-size: inherit !important; }

        div.meter-table { display: flex; flex-wrap: wrap; flex-direction: row; gap: 0.3em; }
        div.one-meter { border: 1px solid black; padding: 4px; border-radius: 6px; text-align: left; }
        div.one-meter.seen { background-color: #1e1; }

        div.field-table { display: flex; flex-wrap: wrap; flex-direction: row; gap: 0.3em; }
        div.field-table.disconnected { opacity: 30%; }
        div.one-field { border: 1px solid #333; padding: 4px; border-radius: 6px; text-align: left; }
        div.one-field-error { background: #ff6633; }
    `;

    render() {
        return html`
        <div class=readout-container>
        <button @click=${this.clearStorage} ?disabled=${this.packetCount == 0}>Clear persistent storage</button>
        <button @click="${this.doConnect}" ?disabled=${this.isConnected}>Connect</button>
        <button @click="${this.doDisconnect}" ?disabled=${!this.isConnected}>Disconnect</button>
        <button @click="${this.downloadPackets}"">Download (${this.meters.reduce((acc, meter) => meter.data ? acc + 1 : acc, 0)} fresh readings, ${this.storedReadings.length} total)</button>
        <button @click="${this.doReadOne}" ?disabled=${!this.isConnected || this.currentlyReading}>Read the meter</button>
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

    async doConnect() {
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
                console.log('Cannot identify meter');
                throw `Cannot identify meter: ${rx}`;
            }
            console.log(res);

            const new_baud_mode = res[1];
            const meterTypeId = res[3];
            console.log(`ID: ${meterTypeId}, new baud mode: ${new_baud_mode}`)

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
                    console.log(res);
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
                        // console.log(`  extra RX 0x${c.toString(16)}`);
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
                    throw `Checksum error: BCC from meter 0x${dataBcc.toString(16)}, calculated 0x${calculatedBcc.toString(16)}`;
                }
                console.log('Checksum with STX/ETX/BCC OK');
            } else {
                console.log('No STX/ETX/BCC to check');
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
            this.currentlyReading = false;
        }
    }

    gotMeterData(meterId, data) {
        let meter = null;
        if (meter = this.meters.find((r) => r.meterId == meterId)) {
            meter.data = data;
        } else {
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


import serial
import sys

global p

if True:
    # with STX/ETX/BCC
    payload_before = b'\x02'
    payload_after = b'\x03T' # change the last byte to invalidate
else:
    # no checksumming
    payload_before = b''
    payload_after = b''

def rx():
    line = p.readline()
    print(f'<<< {line}')
    return line

def tx(line):
    p.write(line)
    print(f'>>> {line}')

EXPECTED = [
    ('<', b'/?!\r\n'),
    ('>', b'/ZPA5\\2AM363801C0269\r\n'),
    ('<', b'\x06050\r\n'),
    ('>', payload_before
     + b'F.F(00000000)\r\n'
     + b'0.0.0(T690100)\r\n'
     + b'C.1.0(06213678)\r\n'
     + b'0.1(80005ED02E)\r\n'
     + b'0.1.0(53)\r\n'
     + b'0.9.1(211156)\r\n'
     + b'0.9.2(20260130)\r\n'
     + b'1.8.1(0036483*kWh)\r\n'
     + b'1.8.2(0000003*kWh)\r\n'
     + b'1.8.0(0036486*kWh)\r\n'
     + b'2.8.0(0000000*kWh)\r\n'
     + b'21.8.0(0011071*kWh)\r\n'
     + b'41.8.0(0013524*kWh)\r\n'
     + b'61.8.0(0011890*kWh)\r\n'
     + b'22.8.0(0000000*kWh)\r\n'
     + b'42.8.0(0000000*kWh)\r\n'
     + b'62.8.0(0000000*kWh)\r\n'
     + b'C.7.1(00000)\r\n'
     + b'C.7.2(00000)\r\n'
     + b'C.7.3(00000)\r\n'
     + b'0.3.3(00250*imp/kWh)\r\n'
     + b'0.3.0(10000*imp/kWh)\r\n'
     + b'C.2.5(202110051413)\r\n'
     + b'0.2.0(V0269)\r\n'
     + b'0.2.1(PRE_AM363_D_8000)\r\n'
     + b'C.8.1(03713849)\r\n'
     + b'C.8.2(00000026)\r\n'
     + b'C.8.0(03713915)\r\n'
     + b'C.82.0(00000002)\r\n'
     + b'C.50(03713847)\r\n'
     + b'0.9.0(03787858)\r\n'
     + b'C.14.1(1)\r\n'
     + b'C.6.3(3.20*V)\r\n'
     + b'C.6.0(00075841)\r\n'
     + b'C.51.16(202505051221)\r\n'
     + b'C.51.2(200001051026)\r\n'
     + b'82.8.1(0000001)\r\n'
     + b'C.51.6(000000000000)\r\n'
     + b'C.1.5(200001010100)\r\n'
     + b'32.7.0(238.0*V)\r\n'
     + b'52.7.0(242.2*V)\r\n'
     + b'72.7.0(239.2*V)\r\n'
     + b'31.7.0(2.14*A)\r\n'
     + b'51.7.0(2.17*A)\r\n'
     + b'71.7.0(1.64*A)\r\n'
     + b'1.6.0(2.002*kW)\r\n'
     + b'1.6.0,5(202601130730)\r\n'
     + b'1.6.1(2.000*kW)\r\n'
     + b'1.6.1,5(202601130730)\r\n'
     + b'1.6.2(0.000*kW)\r\n'
     + b'1.6.2,5(200001010100)\r\n'
     + b'32.6.0(244.2*V)\r\n'
     + b'32.6.0,5(202601251510)\r\n'
     + b'52.6.0(245.6*V)\r\n'
     + b'52.6.0,5(202601270620)\r\n'
     + b'72.6.0(244.6*V)\r\n'
     + b'72.6.0,5(202601292040)\r\n'
     + b'31.6.0(3.58*A)\r\n'
     + b'31.6.0,5(202601130730)\r\n'
     + b'51.6.0(4.29*A)\r\n'
     + b'51.6.0,5(202601070810)\r\n'
     + b'71.6.0(3.06*A)\r\n'
     + b'71.6.0,5(202601251320)\r\n'
     + b'C.2.9(202505051121)\r\n'
     + b'!\r\n'
     + payload_after),
]

p = serial.Serial(sys.argv[1], 9600)

for (direction, blob) in EXPECTED:
    if direction == '>':
        tx(blob)
    elif direction == '<':
        print('... reading line...')
        line = rx()
        if line != blob:
            print(f'{line.hex()} != {blob.hex()}')
            tx(b'\r\nXXX\r\n')
            sys.exit(1)
    else:
        print(f'Unknown {direction=}')
        sys.exit(1)

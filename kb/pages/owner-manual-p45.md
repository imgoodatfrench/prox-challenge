<!--prox:meta
{
  "content_types": [
    "schematic",
    "diagram"
  ],
  "doc": "owner-manual",
  "docOrder": 0,
  "docTitle": "Owner's Manual",
  "figures": [
    {
      "data": "Output studs OUT+ (through Hall sensor and output inductor) and OUT-; eight-diode secondary rectifier bank with RC snubbers; main transformer marked T60/0/28 with secondary pins 1,2 and 3,4,5,6; four IGBTs in full-bridge primary with snubber caps and DC-link capacitors; separate PFC sub-block with two IGBTs and boost inductor plus bleed resistor; input RECTIFIER block with terminals 1,2,3,4 (+/-); AC input leads labeled K1 AC 120-240V/50-60HZ with terminals AC1, AC2 and ground G; auxiliary supply with 24V rail, relay coil/contacts and four fuse/thermal elements; fan connectors FAN2 (pins 1,2) and FAN (pins 1,2) to two cooling fans; MCU BOARD connected via ribbon connectors CN5 and CN1 (approx. pins 1-36 each) with three opto/relay devices and two pushbuttons; LCD SCREEN connected to MCU via CN6 (pins 1-5); CN3 to FAST WIRE FEED SWITCH; CN2 (pins 1-4) to two SOLENOID VALVE blocks; CN4 (pins 1-4) to WIRE FEEDER motor M; CN7 and CN8 to REMOTE BOARD whose CN1/CN2/CN3 feed two AVIATION PLUG receptacles.",
      "description": "Complete internal wiring schematic of the OmniPro 220 showing AC input, input rectifier, PFC stage, IGBT inverter full bridge, main transformer, secondary output rectifier bank, Hall current sensor, output terminals, control boards and external accessories.",
      "kind": "schematic",
      "label": "Figure 1"
    }
  ],
  "id": "owner-manual-p45",
  "image": "kb/images/owner-manual-p45.png",
  "page": 45,
  "section_title": "Wiring Schematic",
  "summary": "Provides the complete internal wiring schematic of the OmniPro 220 so a qualified technician can trace the AC input, PFC/IGBT inverter power stage, control boards, fans, solenoid valves, wire feeder motor, and weld output terminals.",
  "tags": [
    "wiring-schematic",
    "schematic",
    "maintenance",
    "igbt",
    "pfc",
    "mcu-board",
    "lcd-screen",
    "remote-board",
    "solenoid-valve",
    "wire-feeder",
    "fan",
    "rectifier",
    "transformer",
    "hall-sensor",
    "output-terminals",
    "ac-input",
    "aviation-plug",
    "connectors",
    "electrical"
  ],
  "visual_importance": 10
}
prox:meta-->

# Wiring Schematic

> **[Figure 1 — schematic]** Full electrical wiring schematic of the Vulcan OmniPro 220 multiprocess welder, drawn rotated 90° on the page. The heavy outer rectangle represents the machine's main power/inverter board; control assemblies (MCU BOARD, LCD SCREEN, REMOTE BOARD) and external electromechanical parts (fans, solenoid valves, wire feeder motor, aviation plugs) are shown to the right of / below it, connected by labeled connectors CN1–CN8.
>
> Data:
> - **Weld output terminals (top of drawing):** two output studs labeled **OUT+** (positive, routed through a **Hall** current-sensor block and an output inductor/choke to the board node marked "OUT+") and **OUT-** (negative, tied to the opposite output bus). A connector block (CN‑) sits on the left edge of the output section.
> - **Output/secondary stage:** the OUT+ line passes through the Hall effect sensor and a series inductor; a bank of eight parallel rectifier diodes (secondary output rectifier) feeds the output bus, with snubber capacitor/resistor networks (RC snubbers) across the diodes and output. A small diode bridge (four diodes) and resistor/capacitor network appear on the left of this stage.
> - **Main transformer:** center of the drawing, a transformer with primary winding tapped and secondary windings numbered **1, 2** on one side and **3, 4, 5, 6** on the other, marked **T60/0/28** (transformer designation). Two diodes feed the secondary side.
> - **Inverter (primary) stage:** four **IGBT** power switches drawn as two half-bridge legs (two IGBTs per leg, each with anti-parallel/clamp diode and a capacitor snubber) driving the transformer primary in a full-bridge configuration. Series/parallel DC-link capacitors are shown across the DC bus (three capacitor symbols on the bus rails).
> - **PFC section:** a separately outlined sub-block labeled **PFC** containing two **IGBT** devices (labeled IGBT) plus a boost inductor and drive/control module, located between the input rectifier and the DC bus. A bleed resistor is shown across the bus.
> - **Input rectifier:** block labeled **RECTIFIER** with terminals numbered **1, 2, 3, 4** (two bridge modules shown: terminals 1/2/3 and +/‑ with 3/4), fed from the AC input side; a diode bridge (four diodes) and input inductor/common-mode choke are on the left.
> - **AC input:** bottom-left leads marked **K1 AC 120‑240V/50‑60HZ**, with switch/relay contacts and terminals labeled **AC1**, **AC2**, and a ground symbol **G** (earth ground).
> - **Auxiliary power supply:** a small switch-mode auxiliary transformer with rectifier diodes, capacitors, a **24V** rail label, a zener/regulator with transistor, four thermal/fuse elements shown in a row (labeled T/A style devices) feeding the low-voltage supplies for the boards, fans and relays. A relay coil with normally-open contacts is drawn in this section.
> - **Fans:** connectors **FAN2** (pins 1, 2) and **FAN** (pins 1, 2) on the bottom edge of the main board wire to two cooling fans, drawn as two large squares with X-shaped blades.
> - **MCU BOARD:** large block at right with two multi-pin ribbon connectors: **CN5** (pins numbered 1 through ~36) and **CN1** (pins numbered 1 through ~36) mating to the main power board, plus **CN6** to the LCD. It contains three opto-coupler / relay-style devices (each with pins 1‑2 and 3‑4) and two pushbutton switches (top and bottom).
> - **LCD SCREEN:** block at top right, connected to the MCU board through connector **CN6** (pins 1, 2, 3, 4, 5).
> - **CN3 / FAST WIRE FEED SWITCH:** connector **CN3** on the main board wires to the **FAST WIRE FEED SWITCH** (a normally-open momentary switch with pins 1‑2, 3‑4).
> - **CN2 → SOLENOID VALVES:** connector **CN2** (pins 1‑4) feeds two blocks labeled **SOLENOID VALVE** (gas solenoids).
> - **CN4 → WIRE FEEDER:** connector **CN4** (pins 1‑4) feeds the block labeled **WIRE FEEDER** containing motor symbol **M**.
> - **CN7 / CN8 → REMOTE BOARD:** connectors **CN7** and **CN8** on the main board wire to the **REMOTE BOARD**; the remote board has connectors **CN1** (multi-pin), **CN2** and **CN3** which run to two round **AVIATION PLUG** connectors (remote/torch trigger receptacles) shown as circles.

**Item 57812** — For technical questions, please call 1‑800‑444‑3353. — Page 45

*(Side tab index on this page: SAFETY, CONTROLS, WIRE, TIG / STICK, WELDING TIPS, **MAINTENANCE** — the MAINTENANCE tab is highlighted.)*

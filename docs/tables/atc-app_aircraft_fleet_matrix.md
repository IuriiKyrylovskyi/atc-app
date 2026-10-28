# ATC-APP: Terminal Radar — Fleet Registry Matrix

This document lists the consolidated fleet specifications including the requested updates (**Antonov An-22, Boeing C-17, Airbus A340-600, MD-11, MD-88, DC-9**). All performance ranges are tailored for the three-tier simulation engine structure where high-altitude flight tracking runs on **Mach** numbers and terminal operations run on **Indicated Airspeed (IAS) Knots**.

---

## 1. Unified Fleet Table

| Aircraft Model              |    WTC    | Length (m) | Wingspan (m) | Min Cruise (Mach) | Max Cruise (Mach) | Term Min (IAS kt) | Term Max (IAS kt) | Vref (IAS kt) | Rel Scale |
| :-------------------------- | :-------: | :--------: | :----------: | :---------------: | :---------------: | :---------------: | :---------------: | :-----------: | :-------: |
| Airbus A380-800             |   SUPER   |    72.7    |     79.8     |       0.78        |       0.89        |        170        |        250        |      140      |   1.00    |
| Boeing 747-8i               |   HEAVY   |    76.3    |     68.4     |       0.80        |       0.90        |        175        |        250        |      145      |   0.92    |
| Concorde                    |   HEAVY   |    61.6    |     25.6     |       0.95        |       2.04        |        190        |        300        |      160      |   0.58    |
| Airbus A350-1000            |   HEAVY   |    73.8    |     64.8     |       0.78        |       0.89        |        165        |        250        |      142      |   0.90    |
| Boeing 777-9 (777X)         |   HEAVY   |    76.7    |     71.8     |       0.78        |       0.89        |        170        |        250        |      141      |   0.95    |
| Boom Overture               |   HEAVY   |    61.0    |     18.0     |       0.80        |       1.70        |        185        |        290        |      150      |   0.52    |
| Douglas MD-11               |   HEAVY   |    61.2    |     51.7     |       0.75        |       0.87        |        170        |        250        |      148      |   0.73    |
| Airbus A340-600             |   HEAVY   |    75.3    |     63.4     |       0.78        |       0.86        |        165        |        250        |      140      |   0.79    |
| Antonov An-22               |   HEAVY   |    57.9    |     64.4     |       0.35        |       0.60        |        120        |        220        |      115      |   0.81    |
| Boeing C-17 Globemaster III |   HEAVY   |    53.0    |     51.8     |       0.74        |       0.77        |        130        |        250        |      115      |   0.65    |
| Douglas DC-10               |   HEAVY   |    55.5    |     50.4     |       0.74        |       0.85        |        165        |        250        |      142      |   0.70    |
| Airbus A300                 |   HEAVY   |    54.1    |     44.8     |       0.74        |       0.82        |        165        |        250        |      138      |   0.65    |
| Boeing 707                  |   HEAVY   |    46.6    |     44.4     |       0.74        |       0.84        |        170        |        250        |      140      |   0.61    |
| Boeing 787 Dreamliner       |   HEAVY   |    62.8    |     60.1     |       0.78        |       0.89        |        165        |        250        |      138      |   0.81    |
| Embraer E195-E2             |  MEDIUM   |    41.5    |     35.1     |       0.75        |       0.82        |        150        |        250        |      132      |   0.50    |
| Bombardier CRJ-900          |  MEDIUM   |    36.2    |     24.9     |       0.74        |       0.82        |        155        |        250        |      135      |   0.39    |
| Gulfstream G650             |  MEDIUM   |    30.4    |     30.4     |       0.80        |       0.93        |        140        |        250        |      125      |   0.41    |
| ATR 72                      |  MEDIUM   |    27.2    |     27.1     |       0.28        |       0.43        |        130        |        240        |      115      |   0.37    |
| Dash 8-Q400                 |  MEDIUM   |    32.8    |     28.4     |       0.35        |       0.55        |        140        |        245        |      122      |   0.41    |
| V-22 Osprey                 |  MEDIUM   |    17.5    |     25.8     |       0.16        |       0.41        |        80         |        220        |      90       |   0.31    |
| Douglas DC-9                |  MEDIUM   |    31.8    |     28.5     |       0.68        |       0.80        |        160        |        250        |      130      |   0.39    |
| Douglas MD-88               |  MEDIUM   |    45.1    |     32.9     |       0.69        |       0.80        |        160        |        250        |      134      |   0.53    |
| Airbus A320                 |  MEDIUM   |    37.6    |     35.8     |       0.74        |       0.82        |        160        |        250        |      135      |   0.49    |
| Boeing 727                  |  MEDIUM   |    40.6    |     32.9     |       0.72        |       0.84        |        165        |        250        |      137      |   0.49    |
| Cessna Citation             | LIGHT/MED |    14.4    |     14.3     |       0.52        |       0.75        |        130        |        250        |      110      |   0.20    |
| Learjet 45                  | LIGHT/MED |    17.6    |     14.6     |       0.73        |       0.81        |        135        |        250        |      120      |   0.22    |
| Douglas DC-3                |  MEDIUM   |    19.7    |     29.0     |       0.18        |       0.29        |        90         |        140        |      85       |   0.33    |
| Cessna C172 Skyhawk         |   LIGHT   |    8.2     |     11.0     |       0.12        |       0.19        |        65         |        110        |      65       |   0.14    |

---

## 2. Relative Proportional Scaling Table (vs A380 Baseline)

This data layout provides pre-computed dynamic multipliers to feed directly into the relative performance curves or UI slider boundaries inside your engine state.

| Aircraft Model              | Rel Min Cruise | Rel Max Cruise | Rel Term Min | Rel Term Max |
| :-------------------------- | :------------: | :------------: | :----------: | :----------: |
| Airbus A380-800             |      1.00      |      1.00      |     1.00     |     1.00     |
| Boeing 747-8i               |      1.03      |      1.01      |     1.03     |     1.00     |
| Concorde                    |      1.22      |      2.29      |     1.12     |     1.20     |
| Airbus A350-1000            |      1.00      |      1.00      |     0.97     |     1.00     |
| Boeing 777-9 (777X)         |      1.00      |      1.00      |     1.00     |     1.00     |
| Boom Overture               |      1.03      |      1.91      |     1.09     |     1.16     |
| Douglas MD-11               |      0.96      |      0.98      |     1.00     |     1.00     |
| Airbus A340-600             |      1.00      |      0.97      |     0.97     |     1.00     |
| Antonov An-22               |      0.45      |      0.67      |     0.71     |     0.88     |
| Boeing C-17 Globemaster III |      0.95      |      0.87      |     0.76     |     1.00     |
| Douglas DC-10               |      0.95      |      0.96      |     0.97     |     1.00     |
| Airbus A300                 |      0.95      |      0.92      |     0.97     |     1.00     |
| Boeing 707                  |      0.95      |      0.94      |     1.00     |     1.00     |
| Boeing 787 Dreamliner       |      1.00      |      1.00      |     0.97     |     1.00     |
| Embraer E195-E2             |      0.96      |      0.92      |     0.88     |     1.00     |
| Bombardier CRJ-900          |      0.95      |      0.92      |     0.91     |     1.00     |
| Gulfstream G650             |      1.03      |      1.04      |     0.82     |     1.00     |
| ATR 72                      |      0.36      |      0.48      |     0.76     |     0.96     |
| Dash 8-Q400                 |      0.45      |      0.62      |     0.82     |     0.98     |
| V-22 Osprey                 |      0.21      |      0.46      |     0.47     |     0.88     |
| Douglas DC-9                |      0.87      |      0.90      |     0.94     |     1.00     |
| Douglas MD-88               |      0.88      |      0.90      |     0.94     |     1.00     |
| Airbus A320                 |      0.95      |      0.92      |     0.94     |     1.00     |
| Boeing 727                  |      0.92      |      0.94      |     0.97     |     1.00     |
| Cessna Citation             |      0.67      |      0.84      |     0.76     |     1.00     |
| Learjet 45                  |      0.94      |      0.91      |     0.79     |     1.00     |
| Douglas DC-3                |      0.23      |      0.33      |     0.53     |     0.56     |
| Cessna C172 Skyhawk         |      0.15      |      0.21      |     0.38     |     0.44     |

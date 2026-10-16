# Hilo (Hydro-Québec)

This integration brings your **Hilo** home, the smart-home service of
Hydro-Québec, into Gladys, **live**: the **challenges** (the peak events Hilo
manages for you: pre-heat, reduction, recovery, rewards) as sensors and scene
triggers, and the Hilo devices (thermostats, plugs, switches and dimmers,
water heater controllers, smart meter, weather stations) with their power. It
uses your Hilo account. Unofficial, not affiliated with Hilo or Hydro-Québec.

> **Development version (0.1).** Written from the protocol of python-hilo and
> of the Hilo integration of Home Assistant (dvd-dev/hilo), and tested with
> simulated answers, not yet with a real Hilo account. Feedback is welcome on
> the GitHub repository.

## What you get

| Device                           | In Gladys                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Hilo challenges                  | challenge (text), challenge announced, pre-heat, reduction and recovery in progress (0/1), reduction start and end, rewards ($) |
| Thermostat (Hilo, Sinopé, Mysa…) | temperature, setpoint (settable), humidity, power, energy                                                                       |
| Plug, load controller            | on/off (settable), power, energy                                                                                                |
| Water heater controller          | on/off (settable), water temperature, power, energy                                                                             |
| Switch, dimmer, bulb             | light (settable), brightness (settable), power, energy                                                                          |
| Smart meter                      | power of the house, energy                                                                                                      |
| Weather station (Netatmo)        | temperature, humidity, CO2, noise, pressure, battery                                                                            |

- **Live**: the values come through Hilo's real-time link (the one of the
  app), not by polling.
- **Commands**: the thermostat setpoints, the on/off of plugs, switches and
  water heaters, the brightness of dimmers, when Hilo allows setting them. The
  value shows at once, Hilo confirms it next.
- **Energy**: Hilo gives the live power but no energy counter. The integration
  therefore computes a kWh index for each device measuring its power (power
  times time, like the "Riemann" meters of Home Assistant), which Gladys turns
  into a 30-minute consumption and a cost. It is an estimate: it only moves
  while the live link works. See below how to use it with the Hydro-Québec
  integration.
- **Badges**: a device Hilo reports disconnected turns `unreachable`.
- The OneLink smoke detector and the gateway have nothing to show and are not
  offered.

## Installation

1. Install the integration from the Gladys store.
2. In the **Configuration** tab, click **Connect** (Hilo account): the Hilo
   sign-in page opens. Sign in with your Hilo account.
3. Hilo then opens a **Home Assistant** page (my.home-assistant.io): this is
   expected, it is the only address Hilo accepts for this app (the one of the
   Home Assistant integration, which the Gladys integration reuses). You do
   not need Home Assistant: **copy the whole address of that page** from the
   browser's address bar (it starts with
   `https://my.home-assistant.io/redirect/oauth?` and contains `code=`).
4. Back in Gladys, open the **Finish the sign-in** action, paste the address
   and submit, within 30 minutes. The status turns "Connected to Hilo".
5. Open the **Discovery** tab and add the devices you want, including **Hilo
   challenges**.

The session is kept in the `/data` volume of the integration: a restart does
not ask to sign in again. Hilo renews the session as long as the integration
runs; if Hilo refuses it one day (expired session, changed password), the
status says so, the **Hilo sign-in needed** trigger fires, and steps 2 to 4
are enough.

## Options

| Option                                | Default   | Role                                                                                                          |
| ------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| Hydro-Québec rate                     | Automatic | Rate D with winter credits (CH) or Flex D, to follow the challenge details when Hilo does not say it          |
| Anticipation before the pre-heat (h)  | 0 (none)  | An "anticipation" phase that many hours before the pre-heat, for an earlier scene trigger (0 to 24)           |
| Lock the setpoints during a reduction | no        | Refuses setpoint changes from Gladys (dashboard, scenes) during the reduction, so the challenge is not spoilt |
| Language of the feature names         | French    | Names of the features of the devices added from now on, and the challenge texts                               |

Actions: **Finish the sign-in**, **Test the connection** (account, location,
number of devices, live link, next challenge) and **Sign out** (forgets the
session).

## Challenges

A Hilo challenge follows the phases Hilo publishes (usually the day before):

1. **announced**: the challenge is planned;
2. **anticipation** (if configured): that many hours before the pre-heat;
3. **pre-heat**: Hilo heats a bit more before the peak;
4. **reduction**: the peak, Hilo lowers the heating; the consumption of this
   period is what counts;
5. **recovery**: back to normal, gradually;
6. **completed**: after the recovery; the final reward may come later.

The **Hilo challenges** device shows the next challenge (or the one in
progress):

- **Challenge**: a text, e.g. "Challenge on Sun, Jan 4: reduction 4:00 p.m. –
  8:00 p.m." or "Reduction until 8:00 p.m.";
- **Challenge announced**, **Pre-heat in progress**, **Reduction in
  progress**, **Recovery in progress**: 1 or 0, for scene conditions ("if a
  reduction is in progress…");
- **Next reduction start / end**: in Québec time;
- **Estimated reward** (during the challenge), **Reward of the last
  challenge**, **Rewards of the season** (in $, winter credits of Rate D;
  Flex D has no reward);
- **Reference consumption** and **Consumption during the reduction** (kWh),
  when Hilo gives them.

The challenge times are Québec's (America/Toronto), whatever the time zone of
your Gladys.

## Scenes

Triggers:

| Trigger                      | Filters                                                     | Variables                                                                           |
| ---------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Hilo challenge announced     | period (morning, evening)                                   | number, rate, pre-heat start, reduction start and end (UTC and Québec time)         |
| Hilo challenge phase started | phase (anticipation, pre-heat, reduction, recovery), period | number, phase name, end of the phase (UTC and Québec time), reduction start and end |
| Hilo challenge ended         | period                                                      | number, result, reward, consumption, reference, energy saved (kWh)                  |
| Hilo sign-in needed          | —                                                           | account e-mail, reason                                                              |

Examples:

- **Phase started: reduction** → lower the setpoint of the non-Hilo heaters,
  turn off the water heater or the EV charger, send a message;
- **Phase started: anticipation** (with 12 h configured) → start the
  dishwasher before the peak;
- **Challenge ended** → send the reward in a message.

Each event is sent once, even when Gladys or the integration restarts in the
middle of a challenge. A phase missed while stopped is sent at the restart if
it is still in progress.

## With the Hydro-Québec integration

The [Hydro-Québec](https://github.com/LM1LC3N7/Gladys-Hydro-Quebec)
integration reads your **Hydro-Québec customer account**: the official
30-minute consumption (one day late), the Rate D and Flex D contracts with
their costs, and the peaks Hydro-Québec announces. Hilo reads your **Hilo
home**: the devices live, their power, and the challenges as Hilo manages
them. They complement each other:

| Need                                                    | Integration                         |
| ------------------------------------------------------- | ----------------------------------- |
| Billed consumption, cost, Rate D / Flex D contract      | Hydro-Québec (main meter of Gladys) |
| Live power of the house, per device                     | Hilo                                |
| Control thermostats, plugs, water heaters               | Hilo                                |
| Hydro-Québec critical peaks (for every customer)        | Hydro-Québec                        |
| Phases and rewards of the Hilo challenges, anticipation | Hilo                                |

For the energy dashboard: keep the Hydro-Québec consumption as the main meter
(it is the billed one), and attach the energy indexes of the Hilo devices
(thermostats, water heater, plugs) to it to see their share. Do not add the
energy of the Hilo smart meter on top of Hydro-Québec's: it is the same
consumption, counted twice.

## Limits

- **One location**: the first of the account, like the Home Assistant
  integration.
- **Sign-in**: Hilo only accepts the redirect address of Home Assistant;
  hence the copy and paste of step 3. If Hilo changes that rule, a new version
  will be needed.
- **Unofficial API**: the one of the Hilo app, as python-hilo documents it.
  Hilo may change it without notice (it happens every challenge season); the
  Home Assistant integration follows these changes and this one will too.
- Not yet: the thermostat mode, the bulb colors, the Hilo notifications, the
  Hilo weather.

## Troubleshooting

- **"This address carries no sign-in code"**: copy the whole address of the
  Home Assistant page, not just its beginning.
- **"Hilo refused the code"**: a code works once and for a few minutes; start
  again at step 2.
- **"Hilo live link lost"**: the integration reconnects by itself (5 s, then
  up to 5 minutes between attempts).
- The logs of the integration give the details; `LOG_LEVEL=debug` shows more.

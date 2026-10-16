// -----------------------------------------------------------------------------
// Runtime texts (status messages, button answers, errors) and the names of
// the devices, features and phases, in English and French. Status messages
// go to Gladys as multi-language objects; names follow the `language` of the
// configuration (they are stored with the devices).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['fr', 'en'];

const both = (en, fr) => ({ en, fr });

/** One text in one language (French when the language is unknown). */
export const word = (texts, language) => texts?.[language] ?? texts?.fr ?? texts?.en ?? '';

/** A multi-language object with `{name}` placeholders filled. */
export const fill = (texts, values = {}) =>
  Object.fromEntries(
    Object.entries(texts).map(([language, text]) => [
      language,
      text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? '')),
    ]),
  );

export const DEVICE_NAMES = {
  challenges: both('Hilo challenges', 'Défis Hilo'),
};

export const FEATURE_NAMES = {
  temperature: both('Temperature', 'Température'),
  'probe-temperature': both('Water temperature', "Température de l'eau"),
  setpoint: both('Setpoint', 'Consigne'),
  humidity: both('Humidity', 'Humidité'),
  power: both('Power', 'Puissance'),
  energy: both('Energy (from the power)', "Énergie (d'après la puissance)"),
  state: both('On/off', 'Marche/arrêt'),
  light: both('Light', 'Lumière'),
  brightness: both('Brightness', 'Luminosité'),
  'water-heater': both('Water heater', 'Chauffe-eau'),
  co2: both('CO2', 'CO2'),
  noise: both('Noise', 'Bruit'),
  pressure: both('Pressure', 'Pression'),
  battery: both('Battery', 'Batterie'),
  status: both('Challenge', 'Défi'),
  scheduled: both('Challenge announced', 'Défi annoncé'),
  preheat: both('Pre-heat in progress', 'Préchauffage en cours'),
  reduction: both('Reduction in progress', 'Réduction en cours'),
  recovery: both('Recovery in progress', 'Reprise en cours'),
  'reduction-start': both('Next reduction start', 'Début de la prochaine réduction'),
  'reduction-end': both('Next reduction end', 'Fin de la prochaine réduction'),
  'expected-reward': both('Estimated reward', 'Récompense estimée'),
  'last-reward': both('Reward of the last challenge', 'Récompense du dernier défi'),
  'season-reward': both('Rewards of the season', 'Récompenses de la saison'),
  baseline: both('Reference consumption', 'Consommation de référence'),
  consumption: both('Consumption during the reduction', 'Consommation pendant la réduction'),
};

export const PHASE_NAMES = {
  scheduled: both('scheduled', 'prévu'),
  anticipation: both('anticipation', 'anticipation'),
  preheat: both('pre-heat', 'préchauffage'),
  reduction: both('reduction', 'réduction'),
  recovery: both('recovery', 'reprise'),
  completed: both('completed', 'terminé'),
};

export const STATUS_TEXTS = {
  none: both('No challenge announced', 'Aucun défi annoncé'),
  scheduled: both(
    'Challenge on {date}: reduction {start} – {end}',
    'Défi le {date} : réduction {start} – {end}',
  ),
  anticipation: both(
    'Challenge coming: pre-heat at {preheat}, reduction {start} – {end}',
    'Défi imminent : préchauffage à {preheat}, réduction {start} – {end}',
  ),
  preheat: both(
    'Pre-heat until {start}, then reduction until {end}',
    "Préchauffage jusqu'à {start}, puis réduction jusqu'à {end}",
  ),
  reduction: both('Reduction until {end}', "Réduction jusqu'à {end}"),
  recovery: both('Recovery until {until}', "Reprise jusqu'à {until}"),
};

export const MESSAGES = {
  notSignedIn: both(
    'Not signed in: click "Connect", sign in to Hilo, then paste the address of the last page in "Finish the sign-in".',
    "Non connecté : cliquez sur « Connecter », connectez-vous à Hilo, puis collez l'adresse de la dernière page dans « Terminer la connexion ».",
  ),
  signInPending: both(
    'Sign-in started: paste the address of the page shown after the Hilo sign-in in "Finish the sign-in".',
    "Connexion commencée : collez l'adresse de la page affichée après la connexion Hilo dans « Terminer la connexion ».",
  ),
  signInExpired: both(
    'The Hilo session expired: click "Connect" and sign in again.',
    'La session Hilo a expiré : cliquez sur « Connecter » et reconnectez-vous.',
  ),
  connected: both('Connected to Hilo ({email})', 'Connecté à Hilo ({email})'),
  connecting: both('Connecting to Hilo…', 'Connexion à Hilo…'),
  hubsDown: both(
    'Hilo live link lost, reconnecting: {error}',
    'Lien direct Hilo perdu, reconnexion : {error}',
  ),
  noLocation: both('No Hilo location on this account', 'Aucun emplacement Hilo sur ce compte'),
  failed: both('Hilo unreachable: {error}', 'Hilo injoignable : {error}'),
};

export const ANSWERS = {
  signedIn: both(
    'Connected to Hilo as {email}. Add the devices from the Discovery tab.',
    "Connecté à Hilo en tant que {email}. Ajoutez les appareils depuis l'onglet Découverte.",
  ),
  signedOut: both(
    'Signed out: the Hilo tokens are forgotten.',
    'Déconnecté : les jetons Hilo sont oubliés.',
  ),
  test: both(
    'Connected as {email}, location {location}: {devices} devices, live link {hubs}. {challenge}',
    'Connecté en tant que {email}, emplacement {location} : {devices} appareils, lien direct {hubs}. {challenge}',
  ),
  hubsUp: both('up', 'actif'),
  hubsDownShort: both('reconnecting', 'en reconnexion'),
  noChallenge: both('No challenge announced.', 'Aucun défi annoncé.'),
  nextChallenge: both('Next challenge: {status}.', 'Prochain défi : {status}.'),
};

export const ERRORS = {
  emptyAddress: both(
    'Paste the address of the page shown after the Hilo sign-in.',
    "Collez l'adresse de la page affichée après la connexion Hilo.",
  ),
  invalidAddress: both(
    'This address carries no sign-in code: copy the whole address of the page shown after the Hilo sign-in.',
    "Cette adresse ne contient pas de code de connexion : copiez l'adresse complète de la page affichée après la connexion Hilo.",
  ),
  refused: both('Hilo refused the sign-in: {reason}', 'Hilo a refusé la connexion : {reason}'),
  noPendingSignIn: both(
    'No sign-in in progress (or more than 30 minutes ago): click "Connect" first.',
    "Aucune connexion en cours (ou il y a plus de 30 minutes) : cliquez d'abord sur « Connecter ».",
  ),
  stateMismatch: both(
    'This address belongs to another sign-in: click "Connect" again and paste the new address.',
    'Cette adresse appartient à une autre connexion : cliquez à nouveau sur « Connecter » et collez la nouvelle adresse.',
  ),
  codeRefused: both(
    'Hilo refused the code (already used or too old): click "Connect" and sign in again. ({reason})',
    'Hilo a refusé le code (déjà utilisé ou trop ancien) : cliquez sur « Connecter » et reconnectez-vous. ({reason})',
  ),
  notSignedIn: both('Not signed in to Hilo.', 'Non connecté à Hilo.'),
  notReady: both('Hilo is not connected yet.', "Hilo n'est pas encore connecté."),
  unknownDevice: both('Unknown Hilo device.', 'Appareil Hilo inconnu.'),
  readOnly: both(
    'This value cannot be set from Gladys.',
    'Cette valeur ne se règle pas depuis Gladys.',
  ),
  challengeLock: both(
    'A Hilo challenge reduction is in progress: setpoint changes are locked (see the configuration).',
    'Une réduction de défi Hilo est en cours : les changements de consigne sont bloqués (voir la configuration).',
  ),
};

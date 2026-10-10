// Development-only restrictions composed with the existing authoritative Rules.
// Never grant at a parent: RTDB permissions cascade and cannot be revoked below.
export function buildDevelopmentRules(base) {
  const result = structuredClone(base);
  if (Object.keys(result.rules).join() !== 'lobbies' || !result.rules.lobbies.$code) {
    throw new Error('Review development restrictions for the changed Rules layout.');
  }
  const lobby = "root.child('lobbies').child($code)";
  const user = "root.child('developmentAccess/users').child(auth.uid)";
  const game = "root.child('developmentAccess/games').child($code)";
  const identity = `auth != null && auth.token.firebase.sign_in_provider === 'anonymous' && ${user}.child('enabled').val() === true && ${user}.child('expiresAt').isNumber() && ${user}.child('expiresAt').val() > now`;
  // Creation keeps the existing random code/session handshake. Only an admin-
  // approved Storyteller may bootstrap an entirely absent lobby, never an orphan.
  const owner = `${user}.child('role').val() === 'storyteller' && (${lobby}.child('storytellerUid').val() === auth.uid || !${lobby}.exists())`;
  const player = `${user}.child('role').val() === 'player' && ${lobby}.child('storytellerUid').val() !== auth.uid && ${game}.child('sessionId').isString() && ${game}.child('sessionId').val().length > 0 && ${game}.child('sessionId').val() === ${lobby}.child('session/id').val() && ${game}.child('expiresAt').isNumber() && ${game}.child('expiresAt').val() > now && ${game}.child('players').child(auth.uid).val() === true`;
  const gate = `${identity} && ((${owner}) || (${player}))`;
  const room = result.rules.lobbies.$code;
  // This phase admits Storytellers and players only. A leaked/old display token
  // must not give a removed player an alternate way to read the public view.
  room.displayMembers.$uid['.write'] = false;
  const displayClause = ` || (${lobby}.child('session/version').val() === 2 && ${lobby}.child('session/state').val() === 'active' && ${lobby}.child('displayAccess/token').isString() && ${lobby}.child('displayAccess/sessionId').val() === ${lobby}.child('session/id').val() && ${lobby}.child('displayMembers').child(auth.uid).isString() && ${lobby}.child('displayMembers').child(auth.uid).val() === ${lobby}.child('displayAccess/token').val())`;
  if (!room.public['.read'].endsWith(displayClause + ')')) {
    throw new Error('Review changed public/display authorization before generating development Rules.');
  }
  // Remove only the recognized final display disjunct, retaining the source's
  // remaining expression (including any new restrictions), never replacing it.
  room.public['.read'] = room.public['.read'].slice(0, -displayClause.length - 1) + ')';
  function restrict(node) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '.read' || key === '.write') {
        if (value !== false && typeof value !== 'string') throw new Error('Unexpected permission expression.');
        node[key] = value === false ? false : `(${gate}) && (${value})`;
      } else if (!key.startsWith('.') && value && typeof value === 'object') restrict(value);
    }
  }
  restrict(result.rules);
  // No client (including a Storyteller or a token with an admin claim) can
  // enroll, enumerate, renew or edit access. Only privileged administration can.
  result.rules.developmentAccess = { '.read': false, '.write': false };
  return result;
}

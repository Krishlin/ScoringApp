/**
 * Receives a finished match from the cricket scoring app and appends one row.
 *
 * SETUP (about five minutes, once)
 *  1. Make the Google Sheet you want the matches in.
 *  2. In that sheet: Extensions > Apps Script. Delete whatever is in Code.gs and
 *     paste this whole file in. Save.
 *  3. Deploy > New deployment > type "Web app".
 *       Execute as:      Me
 *       Who has access:  Anyone            <- must be "Anyone", not "Anyone with Google account"
 *     Deploy, approve the permissions it asks for, and copy the Web app URL.
 *     It looks like https://script.google.com/macros/s/AKfy..../exec
 *  4. Paste that URL into SHEET_ENDPOINT at the top of script.js and redeploy the site.
 *
 * To check it works before playing: open the /exec URL in a browser. It should say
 * "Cricket scoring endpoint is live." If it shows a Google sign-in page instead,
 * access is not set to "Anyone" and the app will report that it could not save.
 *
 * Changing this file later needs Deploy > Manage deployments > edit > New version,
 * otherwise the old code keeps running.
 */

const SHEET_NAME = 'Matches';

const HEADERS = [
  'Played at',
  'Batted first',
  'Score',
  'Overs',
  'Batted second',
  'Score',
  'Overs',
  'Result',
  'Match ID'
];

function doGet() {
  return ContentService
    .createTextOutput('Cricket scoring endpoint is live.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  // One writer at a time, so two phones finishing together cannot interleave rows.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return reply({ ok: false, error: 'sheet was busy, try again' });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return reply({ ok: false, error: 'no match data in the request' });
    }

    const match = JSON.parse(e.postData.contents);
    const sheet = getMatchSheet();

    // The app retries failed uploads, so the same match can arrive twice.
    if (match.matchId && findRowByMatchId(sheet, match.matchId)) {
      return reply({ ok: true, duplicate: true });
    }

    sheet.appendRow([
      match.playedAt ? new Date(match.playedAt) : new Date(),
      side(match.first).team,
      side(match.first).score,
      side(match.first).overs,
      side(match.second).team,
      side(match.second).score,
      side(match.second).overs,
      match.result || '',
      match.matchId || ''
    ]);

    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function getMatchSheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = book.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function findRowByMatchId(sheet, matchId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const column = HEADERS.indexOf('Match ID') + 1;
  const ids = sheet.getRange(2, column, lastRow - 1, 1).getValues();

  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === matchId) return i + 2;
  }
  return null;
}

function side(innings) {
  const team = innings || {};
  return {
    team: team.team || '',
    score: team.runs + '/' + team.wickets,
    overs: team.overs || ''
  };
}

function reply(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

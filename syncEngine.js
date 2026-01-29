const db = require("./mysql");
const sheetsClient = require("./sheet");

/*
 Row structure:
 uuid | name | updated_at | version | source
*/

function chooseWinner(a, b) {
  if (a.version !== b.version) {
    return a.version > b.version ? a : b;
  }
  return new Date(a.updated_at) > new Date(b.updated_at) ? a : b;
}

exports.sync = async () => {
  try {

    // ----------------------
    // 1. READ MYSQL
    // ----------------------
    const [mysqlRows] = await db.query("SELECT * FROM users");

    // ----------------------
    // 2. READ GOOGLE SHEET
    // ----------------------
    const sheetRes = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: "Sheet1"
    });

    const sheetRows = (sheetRes.data.values || [])
      .slice(1)
      .map(r => ({
        uuid: r[0],
        name: r[1],
        updated_at: r[2],
        version: Number(r[3]),
        source: r[4]
      }));

    // ----------------------
    // 3. INDEX SHEET ROW NUMBERS
    // ----------------------
    const sheetIndex = {};
    sheetRows.forEach((row, i) => {
      sheetIndex[row.uuid] = i + 2; // header offset
    });

    // ----------------------
    // 4. MERGE BOTH SOURCES
    // ----------------------
    const map = new Map();

    mysqlRows.forEach(r => {
      map.set(r.uuid, { mysql: r });
    });

    sheetRows.forEach(r => {
      map.set(r.uuid, { ...(map.get(r.uuid) || {}), sheet: r });
    });

    // ----------------------
    // 5. SYNC LOGIC
    // ----------------------
    for (const v of map.values()) {

      // Only in sheet -> insert into mysql
      if (!v.mysql) {
        await db.query(
          "INSERT INTO users (uuid,name,updated_at,version,source) VALUES (?,?,?,?,?)",
          Object.values(v.sheet)
        );
      }

      // Only in mysql -> insert into sheet
      else if (!v.sheet) {
        await sheetsClient.spreadsheets.values.append({
          spreadsheetId: process.env.SHEET_ID,
          range: "Sheet1",
          valueInputOption: "RAW",
          requestBody: {
            values: [Object.values(v.mysql)]
          }
        });
      }

      // Exists in both -> resolve conflict
      else {
        const winner = chooseWinner(v.mysql, v.sheet);

        // Winner is MYSQL → update SHEET
        if (winner.source === "mysql") {

          const rowNum = sheetIndex[winner.uuid];

          if (rowNum) {
            // update existing row
            await sheetsClient.spreadsheets.values.update({
              spreadsheetId: process.env.SHEET_ID,
              range: `Sheet1!A${rowNum}:E${rowNum}`,
              valueInputOption: "RAW",
              requestBody: {
                values: [Object.values(winner)]
              }
            });
          } else {
            // insert new
            await sheetsClient.spreadsheets.values.append({
              spreadsheetId: process.env.SHEET_ID,
              range: "Sheet1",
              valueInputOption: "RAW",
              requestBody: {
                values: [Object.values(winner)]
              }
            });
          }

        }

        // Winner is SHEET → update MYSQL
        else {
          await db.query(
            "UPDATE users SET name=?, updated_at=?, version=?, source=? WHERE uuid=?",
            [
              winner.name,
              winner.updated_at,
              winner.version,
              winner.source,
              winner.uuid
            ]
          );
        }
      }
    }

    console.log("synced");

  } catch (err) {
    console.error("SYNC ERROR:", err.message);
  }
};


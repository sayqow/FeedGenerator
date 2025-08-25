
const { google } = require('googleapis');

(async () => {
  try{
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    const client = await auth.getClient();
    const drive = google.drive({ version:'v3', auth: client });
    let pageToken = undefined;
    const out = [];
    do{
      const resp = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        fields: 'files(id,name), nextPageToken',
        pageSize: 1000, pageToken
      });
      for (const f of (resp.data.files||[])) out.push(f);
      pageToken = resp.data.nextPageToken;
    } while(pageToken);
    out.forEach(f=>console.log(`${f.id}\t${f.name}`));
  }catch(e){ console.error('[ERR]', e.message); process.exit(1); }
})();

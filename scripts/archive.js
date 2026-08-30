// 每月最後一天 21:00（台北）由 GitHub Actions 呼叫：
// 把當月營收資料存檔到 docs/data/archive/，並清空 revenue.json 讓下個月從零開始
const fs = require('fs');
const path = require('path');

const FORCE = process.env.ARCHIVE_FORCE === '1'; // 手動測試用

function main() {
    const nowTpe = new Date(Date.now() + 8 * 3600 * 1000); // 台北時間 (UTC+8)
    const lastDay = new Date(nowTpe.getFullYear(), nowTpe.getMonth() + 1, 0).getDate();
    if (!FORCE && nowTpe.getDate() !== lastDay) {
        console.log('今天不是當月最後一天，跳過存檔');
        return;
    }

    // 資料所屬月份（與 crawler.js 計算方式一致：抓的是上個月的營收）
    const m = nowTpe.getMonth();
    const dataMonth = m === 0
        ? `${nowTpe.getFullYear() - 1}-12`
        : `${nowTpe.getFullYear()}-${String(m).padStart(2, '0')}`;

    const dataDir = path.join(__dirname, '../docs/data');
    const revPath = path.join(dataDir, 'revenue.json');

    if (!fs.existsSync(revPath)) {
        console.log('找不到 revenue.json，跳過');
        return;
    }

    let data = [];
    try { data = JSON.parse(fs.readFileSync(revPath, 'utf8')); } catch (e) {}

    if (Array.isArray(data) && data.length > 0) {
        const toArchive = data.filter(i => !i.month || i.month === dataMonth);
        if (toArchive.length > 0) {
            const archiveDir = path.join(dataDir, 'archive');
            if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
            const archivePath = path.join(archiveDir, `revenue_${dataMonth}.json`);
            fs.writeFileSync(archivePath, JSON.stringify(toArchive, null, 2));
            console.log(`已存檔 ${toArchive.length} 筆 → docs/data/archive/revenue_${dataMonth}.json`);
        } else {
            console.log('沒有可存檔的當月資料');
        }
    }

    // 清空頁面資料
    fs.writeFileSync(revPath, '[]');
    console.log('revenue.json 已清空，下個月從零開始');
}

main();

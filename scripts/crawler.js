const axios = require('axios');
const fs = require('fs');
const path = require('path');

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
    'Origin': 'https://mops.twse.com.tw',
    'Referer': 'https://mops.twse.com.tw/mops/'
};

/**
 * 同步 n8n 的解析邏輯，包含備註抓取
 */
function parseRevenueHtml(html) {
    let result = { name: "", id: "", revenue: "", growth: "", note: "" };
    if (!html) return result;

    const idMatch = html.match(new RegExp("name='compID'\\s*value='(\\d+)'", "i"));
    result.id = idMatch ? idMatch[1] : "";

    const nameMatch = html.match(new RegExp("本資料由\\s*\\(.*?\\)\\s*([^\\s ]+)", ""));
    result.name = nameMatch ? nameMatch[1].trim() : "";

    const tableMatch = html.match(new RegExp("<TABLE[^>]*class='hasBorder'[^>]*>([\\s\\S]*?)<\\/TABLE>", "i"));
    if (tableMatch) {
        const tableContent = tableMatch[1];
        const fetchValue = (label, content) => {
            const regex = new RegExp(label + "[\\s\\S]*?<TD[^>]*>([\\s\\S]*?)<\\/TD>", "i");
            const match = content.match(regex);
            return match ? match[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim() : '';
        };

        result.revenue = fetchValue('本月', tableContent);
        const parts = tableContent.split(/本年累計/i);
        result.growth = fetchValue('增減百分比', parts[0]) + "%";

        // 抓取備註/原因說明
        const noteMatch = tableContent.match(new RegExp("(?:備註|原因說明)[\\s\\S]*?<TD[^>]*>([\\s\\S]*?)<\\/TD>", "i"));
        result.note = noteMatch ? noteMatch[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim() : '';
    }
    return result;
}

/**
 * 網路層重試：MOPS 偶爾對 GitHub Actions 的 IP 掐連線（ECONNRESET 等），重試幾次再放棄
 * 指數退避：10s → 20s → 40s → 60s，總覆蓋約 2.5 分鐘的封鎖窗口
 */
async function axiosRetry(fn, label, retries = 5) {
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (attempt < retries) {
                const wait = Math.min(attempt * 10000, 60000);
                console.log(`網路錯誤(${err.code || err.message})，${Math.round(wait / 1000)} 秒後重試 ${attempt}/${retries - 1}：${label}`);
                await new Promise(r => setTimeout(r, wait));
            }
        }
    }
    throw lastErr;
}

async function run() {
    // 月末 21:00（台北）已由存檔任務清空資料，跳過當晚剩餘的抓取，避免舊資料重新寫回
    const nowTpe = new Date(Date.now() + 8 * 3600 * 1000);
    const lastDayOfMon = new Date(nowTpe.getFullYear(), nowTpe.getMonth() + 1, 0).getDate();
    if (nowTpe.getDate() === lastDayOfMon && nowTpe.getHours() >= 21) {
        console.log('月末已存檔清空，跳過本次抓取');
        return;
    }

    const dataDir = path.join(__dirname, '../docs/data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const revPath = path.join(dataDir, 'revenue.json');

    try {
        // 營收抓取與合併（網路層重試：MOPS 偶爾對 GitHub Actions 的 IP 掐連線）
        const revListRes = await axiosRetry(() =>
            axios.post('https://mops.twse.com.tw/mops/api/t51sb10', { count: "0", marketKind: "" }, { headers }), '公告列表');
        const revAnnouncements = (revListRes.data?.result?.data || [])
            .filter(row => row.subject && row.subject.trim().endsWith('營業收入資訊'));

        let existingRevenue = [];
        if (fs.existsSync(revPath)) {
            try { existingRevenue = JSON.parse(fs.readFileSync(revPath)); } catch(e) {}
        }

        const now = new Date();
        let targetYear = now.getFullYear() - 1911;
        let targetMonth = now.getMonth();
        if (targetMonth === 0) { targetMonth = 12; targetYear--; }
        // 資料所屬月份（西曆），抓的是上個月的營收；用於月末存檔與分月過濾
        const dataMonth = targetMonth === 0
            ? `${now.getFullYear() - 1}-12`
            : `${now.getFullYear()}-${String(targetMonth).padStart(2, '0')}`;

        // 只保留當月資料（沒有月份標記的舊資料先保留，到月末存檔時一併歸檔）
        existingRevenue = existingRevenue.filter(i => !i.month || i.month === dataMonth);

        // 防爬批次：網站有流量限制，每次運行只抓 15 家（實測安全值）。
        // 跳過本月任務已抓過的公司，接續抓下一批；全部抓完後從頭輪詢（偵測數據變化）。
        const BATCH_SIZE = 15;
        const alreadyDone = new Set(existingRevenue.map(i => String(i.id)));
        const pending = revAnnouncements.filter(row => !alreadyDone.has(String(row.companyId)));
        const batch = pending.length > 0 ? pending.slice(0, BATCH_SIZE) : revAnnouncements.slice(0, BATCH_SIZE);
        console.log(`公告總數: ${revAnnouncements.length}，未抓: ${pending.length}，本次批次: ${batch.length} 家`);

        const newRevenues = [];
        for (const item of batch) {
            console.log(`處理: ${item.companyAbbreviation}`);
            try {
                const params = new URLSearchParams({ step: '1', firstin: 'true', off: '1', isnew: 'true', co_id: item.companyId, year: targetYear.toString(), month: String(targetMonth).padStart(2, '0') });
                const detailRes = await axiosRetry(() =>
                    axios.post('https://mopsov.twse.com.tw/mops/web/ajax_t05st10_ifrs', params.toString(), {
                        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': 'https://mopsov.twse.com.tw/mops/web/t05st10_ifrs' },
                        responseType: 'text', timeout: 25000
                    }), `詳細頁 ${item.companyId}`);
                const parsed = parseRevenueHtml(detailRes.data);
                if (parsed.name) { parsed.month = dataMonth; newRevenues.push(parsed); }
                await new Promise(r => setTimeout(r, 2000));
            } catch (err) {}
        }

        const combined = [...newRevenues, ...existingRevenue];
        const uniqueMap = new Map();
        combined.forEach(item => { if (!uniqueMap.has(item.id)) uniqueMap.set(item.id, item); });

        fs.writeFileSync(revPath, JSON.stringify(Array.from(uniqueMap.values()), null, 2));
        console.log('任務完成');

        // 4. 每日快照：把本次結果累計保留到 history.json（保留最近 30 天），供頁面按日回看
        const todayKey = new Date(nowTpe.getTime()).toISOString().slice(0, 10); // 台北日期
        const histPath = path.join(dataDir, 'history.json');
        let history = { updatedAt: '', days: {} };
        if (fs.existsSync(histPath)) {
            try { history = JSON.parse(fs.readFileSync(histPath, 'utf8')); } catch (e) {}
        }
        const todaySnapshot = Array.from(uniqueMap.values());
        if (todaySnapshot.length > 0 || !history.days[todayKey]) {
            history.days[todayKey] = todaySnapshot;
        }
        const dayKeys = Object.keys(history.days).sort().slice(-30);
        const pruned = {};
        dayKeys.forEach(k => { pruned[k] = history.days[k]; });
        history.days = pruned;
        history.updatedAt = new Date().toISOString();
        fs.writeFileSync(histPath, JSON.stringify(history, null, 2));
        console.log(`每日快照已更新：${todayKey}（${todaySnapshot.length} 筆，共保留 ${dayKeys.length} 天）`);

        // 3. 推送營收彙總到 Telegram（只推本次有新資料或數據有變化的公司，避免重複刷屏）
        const existingMap = new Map(existingRevenue.map(i => [i.id, i]));
        const changed = newRevenues.filter(i => {
            const prev = existingMap.get(i.id);
            return !prev || prev.revenue !== i.revenue || prev.growth !== i.growth || prev.note !== i.note;
        });
        await sendRevenueSummary(changed);
    } catch (error) { console.error('出錯:', error.message); }
}

/**
 * 把營收彙總推送到 Telegram（同 mops_day 的群組）
 */
function formatRevenueSummary(list) {
    if (!list || list.length === 0) return '';

    const lines = list.map(item => {
        const growthVal = parseFloat(item.growth);
        const icon = growthVal > 0 ? '🔺' : (growthVal < 0 ? '🔻' : '▪️');
        return `${icon} ${item.name}(${item.id}) 營收 ${item.revenue} 增減 ${item.growth}`;
    });

    const now = new Date();
    const rocYear = now.getFullYear() - 1911;
    const title = `📊 當月營收彙總（${rocYear}年${now.getMonth() === 0 ? 12 : now.getMonth()}月）共 ${list.length} 家\n`;
    return title + lines.join('\n');
}

async function sendRevenueSummary(list) {
    const text = formatRevenueSummary(list);
    if (!text) return;

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.log('未設定 TELEGRAM_BOT_TOKEN，跳過 Telegram 推送');
        return;
    }

    try {
        // Telegram 單則訊息上限 4096 字元，超長時分段發送
        const chunks = [];
        let buf = '';
        for (const line of text.split('\n')) {
            if ((buf + line + '\n').length > 3900) { chunks.push(buf); buf = ''; }
            buf += line + '\n';
        }
        if (buf) chunks.push(buf);

        for (const chunk of chunks) {
            const res = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                chat_id: process.env.TELEGRAM_CHAT_ID || '-1003333218073',
                text: chunk,
                disable_web_page_preview: true
            }, { timeout: 30000 });
            if (!res.data?.ok) console.error('Telegram 推送失敗:', JSON.stringify(res.data));
        }
        console.log(`Telegram 推送完成（${chunks.length} 則）`);
    } catch (err) {
        console.error('Telegram 推送失敗:', err.response ? JSON.stringify(err.response.data) : err.message);
    }
}
run();

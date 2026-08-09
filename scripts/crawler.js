const axios = require('axios');
const fs = require('fs');
const path = require('path');

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Origin': 'https://mops.twse.com.tw',
    'Referer': 'https://mops.twse.com.tw/mops/web/t05st10_ifrs'
};

function parseRevenueHtml(html) {
    let result = { revenue: "N/A", growth: "0%", id: "", name: "" };
    try {
        // 清理 HTML 中的换行和多余空格，方便正则匹配
        const cleanHtml = html.replace(/\r?\n|\r/g, "").replace(/\s+/g, " ");
        
        const idMatch = cleanHtml.match(/compID'\s*value='(\d+)'/i);
        result.id = idMatch ? idMatch[1] : "";
        
        const nameMatch = cleanHtml.match(/本資料由\s*\(.*?\)\s*([^\s<]+)/);
        result.name = nameMatch ? nameMatch[1].trim() : "";

        // 核心解析逻辑：定位包含“本月”的表格行，提取第一个数字（金额）
        // 使用更宽松的正则匹配 TD 标签内的数字
        const revRowMatch = cleanHtml.match(/本月.*?<td[^>]*>([\d,.-]+)<\/td>/i);
        result.revenue = revRowMatch ? revRowMatch[1] : "N/A";

        // 定位包含“增減百分比”的行。通常第一部分是本月增幅，第二部分是去年同月增幅。
        // 我们需要的是“去年同月增減百分比”
        const growthMatches = cleanHtml.match(/增減百分比.*?<td[^>]*>([\d,.-]+)<\/td>.*?<td[^>]*>([\d,.-]+)<\/td>/i);
        if (growthMatches) {
            // growthMatches[1] 是本月增減百分比，[2] 是去年同月增減百分比
            result.growth = growthMatches[2] + "%";
        } else {
            // 备选方案：尝试匹配单个百分比
            const singleGrowth = cleanHtml.match(/去年同月增減百分比.*?<td[^>]*>([\d,.-]+)<\/td>/i);
            result.growth = singleGrowth ? singleGrowth[1] + "%" : "0%";
        }
    } catch (e) {
        console.error("解析出錯:", e);
    }
    return result;
}

async function run() {
    const dataDir = path.join(__dirname, '../docs/data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    try {
        console.log('1. 獲取公告列表...');
        const annRes = await axios.post('https://mops.twse.com.tw/mops/api/home_page/t05sr01_1', { count: "0", marketKind: "" }, { headers });
        const announcements = (annRes.data?.result?.data || [])
            .filter(item => ['自結', '財務業務', '營收'].some(k => item.subject.includes(k)))
            .slice(0, 10).map(item => ({ name: item.companyAbbreviation, id: item.companyId, date: item.date, subject: item.subject }));

        console.log('2. 獲取營收列表...');
        const revListRes = await axios.post('https://mops.twse.com.tw/mops/api/t51sb10', { count: "0", marketKind: "" }, { headers });
        const revAnnouncements = (revListRes.data?.result?.data || [])
            .filter(item => item.subject && item.subject.includes('營業收入資訊')).slice(0, 8);

        const revenues = [];
        const now = new Date();
        // 如果今天是月初，可能要抓上上個月的数据，这里默认取上个月
        let targetYear = now.getFullYear() - 1911;
        let targetMonth = now.getMonth(); 
        if (targetMonth === 0) { targetMonth = 12; targetYear--; }
        const monthStr = String(targetMonth).padStart(2, '0');

        for (const item of revAnnouncements) {
            console.log(`處理中: ${item.companyAbbreviation} (${item.companyId})`);
            try {
                const params = new URLSearchParams({
                    step: '1', firstin: 'true', off: '1', isnew: 'true',
                    co_id: item.companyId, year: targetYear.toString(), month: monthStr
                });
                
                const detailRes = await axios.post('https://mopsov.twse.com.tw/mops/web/ajax_t05st10_ifrs', params.toString(), { 
                    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
                    responseType: 'text',
                    timeout: 10000
                });

                const parsed = parseRevenueHtml(detailRes.data);
                if (parsed.name) revenues.push(parsed);
                await new Promise(r => setTimeout(r, 2000));
            } catch (err) { console.error(`${item.companyId} 詳情抓取失敗`); }
        }

        revenues.sort((a, b) => parseFloat(b.growth) - parseFloat(a.growth));
        fs.writeFileSync(path.join(dataDir, 'announcements.json'), JSON.stringify(announcements, null, 2));
        fs.writeFileSync(path.join(dataDir, 'revenue.json'), JSON.stringify(revenues.length > 0 ? revenues : [{name:"今日暫無營收更新", id:"-", revenue:"-", growth:"0%"}], null, 2));
        console.log('執行完畢');
    } catch (error) { console.error('出錯:', error.message); }
}
run();

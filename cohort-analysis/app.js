// Cohort Analysis App
const STATE = {
    chart: null,
    data: [],
    xAxisMode: 'tenure' // 'tenure' or 'calendar'
};

// Cohort colors matching the screenshot style
const COHORT_COLORS = {
    '2024 Q1': { color: '#6b7280', dash: [8, 4] },  // Gray, dashed
    '2024 Q2': { color: '#dc2626', dash: [8, 4] },  // Red, dashed
    '2024 Q3': { color: '#16a34a', dash: [8, 4] },  // Green, dashed
    '2024 Q4': { color: '#7c3aed', dash: [8, 4] },  // Purple, dashed
    '2025 Q1': { color: '#3b82f6', dash: [] },      // Blue, solid
    '2025 Q2': { color: '#10b981', dash: [] },      // Emerald, solid
    '2025 Q3': { color: '#f59e0b', dash: [] },      // Orange, solid
    '2025 Q4': { color: '#ec4899', dash: [] },      // Pink, solid
};

// BigQuery query for tenure quarters
const TENURE_QUERY = `
WITH rep_start_dates AS (
  SELECT DISTINCT
    user_id,
    rep_name,
    shopify_start_date
  FROM \`sdp-for-analysts-platform.rev_ops_prod.modelled_rep_scorecard\`
  WHERE shopify_start_date IS NOT NULL
    AND shopify_start_date >= '2024-01-01'
),

cohort_assignment AS (
  SELECT 
    user_id,
    rep_name,
    shopify_start_date,
    CASE 
      WHEN shopify_start_date BETWEEN '2024-01-01' AND '2024-03-31' THEN '2024 Q1'
      WHEN shopify_start_date BETWEEN '2024-04-01' AND '2024-06-30' THEN '2024 Q2'
      WHEN shopify_start_date BETWEEN '2024-07-01' AND '2024-09-30' THEN '2024 Q3'
      WHEN shopify_start_date BETWEEN '2024-10-01' AND '2024-12-31' THEN '2024 Q4'
      WHEN shopify_start_date BETWEEN '2025-01-01' AND '2025-03-31' THEN '2025 Q1'
      WHEN shopify_start_date BETWEEN '2025-04-01' AND '2025-06-30' THEN '2025 Q2'
      WHEN shopify_start_date BETWEEN '2025-07-01' AND '2025-09-30' THEN '2025 Q3'
      WHEN shopify_start_date BETWEEN '2025-10-01' AND '2025-12-31' THEN '2025 Q4'
    END AS cohort,
    DATE_TRUNC(shopify_start_date, QUARTER) AS cohort_quarter_start
  FROM rep_start_dates
),

quarterly_actuals AS (
  SELECT
    salesforce_owner_id,
    salesforce_owner_name,
    EXTRACT(YEAR FROM close_date) AS perf_year,
    EXTRACT(QUARTER FROM close_date) AS perf_quarter,
    DATE_TRUNC(close_date, QUARTER) AS perf_quarter_start,
    SUM(closed_won_lifetime_total_revenue) AS ltr_actuals
  FROM \`sdp-for-analysts-platform.rev_ops_prod.temp_sales_performance\`
  WHERE owner_line_of_business NOT IN ('Lending', 'Ads')
    AND owner_team NOT LIKE '%CSM%'
    AND owner_team NOT IN ('Sales Incubation', 'Launch', 'Partner', 'Unknown', 'D2C Mid-Mkt Cross-Sell', 'D2C Large Cross-Sell')
    AND owner_role_function NOT IN ('Customer Success')
    AND (owner_user_role NOT LIKE '%INC%' OR owner_user_role IS NULL)
    AND close_date BETWEEN '2024-01-01' AND CURRENT_DATE()
  GROUP BY 1, 2, 3, 4, 5
),

quarterly_targets AS (
  SELECT 
    w.worker_full_name,
    EXTRACT(YEAR FROM LAST_DAY(DATE(
      CAST(SUBSTRING(periods, 3, 4) AS INT64),
      CAST(SUBSTRING(periods, 8, 2) AS INT64),
      1
    ), QUARTER)) AS target_year,
    EXTRACT(QUARTER FROM LAST_DAY(DATE(
      CAST(SUBSTRING(periods, 3, 4) AS INT64),
      CAST(SUBSTRING(periods, 8, 2) AS INT64),
      1
    ), QUARTER)) AS target_quarter,
    SUM(CASE WHEN attributeID = 'TOTAL REVENUE : PERIODIC : QUOTA' THEN quota END) AS ltr_quota
  FROM \`shopify-dw.raw_varicent.attainmentdata\` v
  LEFT JOIN \`shopify-dw.people.worker_current\` w ON v.PayeeID_ = w.worker_id
  WHERE attributeID = 'TOTAL REVENUE : PERIODIC : QUOTA'
    AND worker_full_name IS NOT NULL
  GROUP BY 1, 2, 3
),

rep_performance AS (
  SELECT
    ca.cohort,
    ca.user_id,
    DATE_DIFF(qa.perf_quarter_start, ca.cohort_quarter_start, QUARTER) + 1 AS tenure_quarter,
    CONCAT(qa.perf_year, ' Q', qa.perf_quarter) AS calendar_quarter,
    qa.ltr_actuals,
    qt.ltr_quota
  FROM cohort_assignment ca
  JOIN quarterly_actuals qa ON ca.user_id = qa.salesforce_owner_id
  LEFT JOIN quarterly_targets qt ON ca.rep_name = qt.worker_full_name 
    AND qa.perf_year = qt.target_year 
    AND qa.perf_quarter = qt.target_quarter
  WHERE ca.cohort IS NOT NULL
)

SELECT
  cohort,
  tenure_quarter,
  CASE tenure_quarter
    WHEN 1 THEN 'First Quarter'
    WHEN 2 THEN 'Second Quarter'
    WHEN 3 THEN 'Third Quarter'
    WHEN 4 THEN 'Fourth Quarter'
    WHEN 5 THEN 'Fifth Quarter'
    WHEN 6 THEN 'Sixth Quarter'
    ELSE CONCAT('Quarter ', tenure_quarter)
  END AS tenure_quarter_label,
  calendar_quarter,
  COUNT(DISTINCT user_id) AS rep_count,
  SAFE_DIVIDE(SUM(ltr_actuals), NULLIF(SUM(ltr_quota), 0)) AS attainment
FROM rep_performance
WHERE tenure_quarter BETWEEN 1 AND 6
GROUP BY cohort, tenure_quarter, calendar_quarter
ORDER BY cohort, tenure_quarter
`;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    checkAuth();
});

async function checkAuth() {
    try {
        const authResult = await quick.auth.requestScopes([
            'https://www.googleapis.com/auth/bigquery'
        ]);
        
        if (authResult.hasRequiredScopes) {
            loadData();
        } else {
            alert('BigQuery permissions required. Please authorize and refresh.');
        }
    } catch (error) {
        console.error('Auth error:', error);
        alert('Authentication error: ' + error.message);
    }
}

function initEventListeners() {
    document.getElementById('refreshBtn').addEventListener('click', loadData);
    document.getElementById('tenureBtn').addEventListener('click', () => {
        STATE.xAxisMode = 'tenure';
        document.getElementById('tenureBtn').classList.add('active');
        document.getElementById('calendarBtn').classList.remove('active');
        renderChart();
    });
    document.getElementById('calendarBtn').addEventListener('click', () => {
        STATE.xAxisMode = 'calendar';
        document.getElementById('calendarBtn').classList.add('active');
        document.getElementById('tenureBtn').classList.remove('active');
        renderChart();
    });
}

async function loadData() {
    showLoading(true);
    try {
        const result = await quick.dw.querySync(TENURE_QUERY);
        STATE.data = result.results || [];
        renderChart();
    } catch (error) {
        console.error('Error loading data:', error);
        alert('Error loading data: ' + error.message);
    } finally {
        showLoading(false);
    }
}

function renderChart() {
    const ctx = document.getElementById('cohortChart').getContext('2d');
    
    if (STATE.chart) {
        STATE.chart.destroy();
    }

    const cohorts = [...new Set(STATE.data.map(d => d.cohort))].sort();
    
    let labels, datasets;
    
    if (STATE.xAxisMode === 'tenure') {
        // X-axis = tenure quarters (First Quarter, Second Quarter, etc.)
        labels = ['First Quarter', 'Second Quarter', 'Third Quarter', 'Fourth Quarter'];
        datasets = cohorts.map(cohort => {
            const cohortData = STATE.data.filter(d => d.cohort === cohort);
            const data = labels.map((_, idx) => {
                const row = cohortData.find(d => d.tenure_quarter === idx + 1);
                return row ? row.attainment * 100 : null;
            });
            const style = COHORT_COLORS[cohort] || { color: '#64748b', dash: [] };
            return {
                label: cohort,
                data: data,
                borderColor: style.color,
                backgroundColor: style.color,
                borderDash: style.dash,
                borderWidth: style.dash.length ? 2 : 3,
                pointRadius: 6,
                pointBackgroundColor: '#0f172a',
                pointBorderColor: style.color,
                pointBorderWidth: 2,
                tension: 0.1,
                spanGaps: true
            };
        });
    } else {
        // X-axis = calendar quarters (2024 Q1, 2024 Q2, etc.)
        const allQuarters = [...new Set(STATE.data.map(d => d.calendar_quarter))].sort();
        labels = allQuarters;
        datasets = cohorts.map(cohort => {
            const cohortData = STATE.data.filter(d => d.cohort === cohort);
            const data = labels.map(q => {
                const row = cohortData.find(d => d.calendar_quarter === q);
                return row ? row.attainment * 100 : null;
            });
            const style = COHORT_COLORS[cohort] || { color: '#64748b', dash: [] };
            return {
                label: cohort,
                data: data,
                borderColor: style.color,
                backgroundColor: style.color,
                borderDash: style.dash,
                borderWidth: style.dash.length ? 2 : 3,
                pointRadius: 6,
                pointBackgroundColor: '#0f172a',
                pointBorderColor: style.color,
                pointBorderWidth: 2,
                tension: 0.1,
                spanGaps: true
            };
        });
    }

    STATE.chart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleFont: { size: 13, weight: '600' },
                    bodyFont: { size: 12 },
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(0)}%`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(0, 0, 0, 0.05)' },
                    ticks: { font: { size: 12 }, color: '#64748b' }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0, 0, 0, 0.05)' },
                    ticks: {
                        font: { size: 12 },
                        color: '#64748b',
                        callback: value => value + '%'
                    },
                    title: {
                        display: true,
                        text: 'Avg Attainment (%)',
                        font: { size: 12, weight: '500' },
                        color: '#64748b'
                    }
                }
            }
        }
    });

    generateLegend(datasets);
}

function generateLegend(datasets) {
    const container = document.getElementById('customLegend');
    container.innerHTML = '';
    
    datasets.forEach((ds, idx) => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.dataset.index = idx;
        
        const lineStyle = ds.borderDash.length ? 'dashed' : 'solid';
        item.innerHTML = `
            <span class="legend-line ${lineStyle}" style="color: ${ds.borderColor}"></span>
            <span>${ds.label}</span>
        `;
        
        item.addEventListener('click', () => {
            const meta = STATE.chart.getDatasetMeta(idx);
            meta.hidden = !meta.hidden;
            item.classList.toggle('hidden', meta.hidden);
            STATE.chart.update();
        });
        
        container.appendChild(item);
    });
}

function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.toggle('visible', show);
}

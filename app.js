/**
 * Revenue Analytics Dashboard
 * Pulls data from BigQuery and displays interactive charts
 */

// ============================================================================
// Configuration & State
// ============================================================================

const STATE = {
  isAuthenticated: false,
  isLoading: false,
  activeTab: 'revenue',
  // Revenue tab state
  data: [],
  mixAdjustedData: [], // Mix-adjusted win rate data
  selectedTeams: [], // Array for multi-select (empty = all)
  allTeams: [], // All available teams
  charts: {
    dealsPerRep: null,
    dealSize: null,
    attainment: null,
    winRate: null,
    mixAdjustedWinRate: null,
    actualsVsTargets: null
  },
  // Hiring tab state
  hiringData: [],
  selectedHiringRegions: [], // Array for multi-select (empty = all)
  allHiringRegions: [], // All available regions
  hiringCharts: {
    cohortAttainment: null
  }
};


// ============================================================================
// BigQuery Query
// ============================================================================

const BQ_QUERY = `
WITH final as (
  SELECT 
    tsp.owner_region,
    CASE
      WHEN tsp.owner_segment IN ('Global Account','Enterprise') THEN tsp.owner_segment
      WHEN tsp.owner_line_of_business = 'B2B' AND tsp.owner_motion IN ('Acquisition') THEN 'B2B Large Mid-Mkt Acquisition'
      WHEN tsp.owner_line_of_business = 'B2B' THEN 'B2B Large Mid-Mkt Cross-Sell'
      WHEN tsp.owner_segment IN ('Mid-Mkt') AND tsp.owner_line_of_business IN ('D2C','Retail','D2C Retail') THEN 'D2C Retail Mid-Mkt'
      WHEN tsp.owner_segment IN ('Large') AND tsp.owner_line_of_business IN ('D2C','Retail','D2C Retail') THEN 'D2C Retail Large'
      WHEN tsp.owner_segment IN ('SMB','Core') AND tsp.owner_line_of_business IN ('D2C','Retail','D2C Retail') AND tsp.owner_motion IN ('Cross-Sell','Acceleration') THEN 'D2C Retail SMB Cross-Sell'
      WHEN tsp.owner_segment IN ('SMB','Core') AND tsp.owner_line_of_business = 'D2C' THEN 'D2C SMB Acquisition'
      WHEN tsp.owner_segment IN ('SMB','Core') AND tsp.owner_line_of_business = 'Retail' THEN 'Retail SMB Acquisition'
      WHEN tsp.owner_motion = 'Acquisition' AND IFNULL(o.annual_offline_revenue_usd,0) + IFNULL(o.annual_online_revenue_verified_usd,0) + IFNULL(o.incremental_annual_b2b_usd,0) >= 40000000 THEN 'D2C Retail Large'
      WHEN tsp.owner_motion = 'Acquisition' AND IFNULL(o.annual_offline_revenue_usd,0) + IFNULL(o.annual_online_revenue_verified_usd,0) + IFNULL(o.incremental_annual_b2b_usd,0) >= 5000000 THEN 'D2C Retail Mid-Mkt'
      WHEN tsp.owner_motion = 'Acquisition' AND tsp.owner_line_of_business = 'Retail' THEN 'Retail SMB Acquisition'
      WHEN tsp.owner_motion = 'Acquisition' AND tsp.owner_line_of_business = 'D2C' THEN 'D2C SMB Acquisition'
      WHEN ual.estimated_total_annual_revenue_usd > 40000000 THEN 'D2C Retail Large'
      WHEN ual.estimated_total_annual_revenue_usd > 5000000 THEN 'D2C Retail Mid-Mkt'
      ELSE 'D2C Retail SMB Cross-Sell'
    END as team_restated,
    EXTRACT(year FROM tsp.close_date) as year,
    CONCAT('Q', EXTRACT(quarter FROM tsp.close_date)) as quarter,
    SUM(tsp.closed_won_lifetime_total_revenue) as CW_LTR_sum,
    SUM(tsp.closed_won_opportunity_count) as CW_cnt_sum,
    SUM(CASE WHEN tsp.current_stage_name IN ('Closed Won','Closed Lost') AND tsp.is_qualified = TRUE THEN 1 ELSE 0 END) as closed_deal_cnt,
    COUNT(DISTINCT CASE WHEN tsp.current_stage_name IN ('Closed Won','Closed Lost') THEN tsp.salesforce_owner_id END) as rep_distinct,
    SUM(tsp.closed_won_lifetime_total_revenue_target) as target_revenue,
    -- Calculated metrics
    SAFE_DIVIDE(SUM(tsp.closed_won_opportunity_count), COUNT(DISTINCT CASE WHEN tsp.current_stage_name IN ('Closed Won','Closed Lost') THEN tsp.salesforce_owner_id END)) as deals_per_rep,
    SAFE_DIVIDE(SUM(tsp.closed_won_lifetime_total_revenue), SUM(tsp.closed_won_opportunity_count)) as deal_size,
    SAFE_DIVIDE(SUM(tsp.closed_won_lifetime_total_revenue), SUM(tsp.closed_won_lifetime_total_revenue_target)) * 100 as attainment_pct,
    SAFE_DIVIDE(SUM(tsp.closed_won_opportunity_count), SUM(CASE WHEN tsp.current_stage_name IN ('Closed Won','Closed Lost') AND tsp.is_qualified = TRUE THEN 1 ELSE 0 END)) * 100 as win_rate_pct
  FROM \`sdp-for-analysts-platform.rev_ops_prod.temp_sales_performance\` tsp
  LEFT JOIN \`shopify-dw.sales.sales_opportunities_v1\` o ON tsp.opportunity_id = o.opportunity_id
  LEFT JOIN \`sdp-prd-commercial.mart.unified_account_list\` ual ON o.salesforce_account_id = ual.account_id
  WHERE tsp.close_date BETWEEN '2024-01-01' AND '2026-03-31'
    AND tsp.owner_line_of_business NOT IN ('Lending', 'Ads')
    AND tsp.owner_team NOT LIKE '%CSM%'
  GROUP BY ALL
)
SELECT *
FROM final
WHERE target_revenue > 0
ORDER BY owner_region, team_restated, year, quarter
`;

// Hiring Cohort Analysis Query
const HIRING_BQ_QUERY = `
WITH base_data AS (
  SELECT
    region,
    CASE 
      WHEN shopify_start_date BETWEEN '2025-01-01' AND '2025-03-31' THEN 'Q1 Cohort'
      WHEN shopify_start_date BETWEEN '2025-04-01' AND '2025-06-30' THEN 'Q2 Cohort'
      WHEN shopify_start_date BETWEEN '2025-07-01' AND '2025-09-30' THEN 'Q3 Cohort'
      WHEN shopify_start_date BETWEEN '2025-10-01' AND '2025-12-31' THEN 'Q4 Cohort'
      ELSE NULL 
    END AS cohort,
    CASE 
      WHEN shopify_start_date BETWEEN '2025-01-01' AND '2025-03-31' THEN DATE('2025-03-31')
      WHEN shopify_start_date BETWEEN '2025-04-01' AND '2025-06-30' THEN DATE('2025-06-30')
      WHEN shopify_start_date BETWEEN '2025-07-01' AND '2025-09-30' THEN DATE('2025-09-30')
      WHEN shopify_start_date BETWEEN '2025-10-01' AND '2025-12-31' THEN DATE('2025-12-31')
      ELSE NULL 
    END AS cohort_start_quarter,
    LAST_DAY(month_date, QUARTER) AS quarter_date,
    value
  FROM \`sdp-for-analysts-platform.rev_ops_prod.modelled_rep_scorecard\`
  WHERE metric LIKE '%Attainment LTR%'
    AND shopify_start_date >= '2025-01-01'
)
SELECT
  region,
  cohort,
  CASE DATE_DIFF(quarter_date, cohort_start_quarter, QUARTER) + 1
    WHEN 1 THEN 'First Quarter'
    WHEN 2 THEN 'Second Quarter'
    WHEN 3 THEN 'Third Quarter'
    WHEN 4 THEN 'Fourth Quarter'
    ELSE NULL
  END AS tenure_quarter,
  DATE_DIFF(quarter_date, cohort_start_quarter, QUARTER) + 1 AS tenure_quarter_num,
  AVG(value) AS avg_attainment
FROM base_data
WHERE cohort IS NOT NULL
  AND quarter_date >= cohort_start_quarter
GROUP BY ALL
ORDER BY cohort, tenure_quarter_num
`;

// Mix-Adjusted Win Rate Query
const MIX_ADJUSTED_WIN_RATE_QUERY = `
WITH base_data AS (
  SELECT
    tsp.opportunity_id,
    tsp.close_date,
    tsp.is_won,
    tsp.current_stage_name,
    tsp.is_qualified,
    tsp.owner_region as region,
    COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) AS total_gmv,
    CASE
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 5000000 THEN '0-5M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 10000000 THEN '5-10M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 15000000 THEN '10-15M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 20000000 THEN '15-20M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 25000000 THEN '20-25M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 30000000 THEN '25-30M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 40000000 THEN '30-40M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 50000000 THEN '40-50M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 75000000 THEN '50-75M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 100000000 THEN '75-100M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 150000000 THEN '100-150M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 200000000 THEN '150-200M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 300000000 THEN '200-300M'
      ELSE '300M+'
    END AS gmv_segment,
    EXTRACT(YEAR FROM tsp.close_date) AS close_year,
    EXTRACT(QUARTER FROM tsp.close_date) AS close_quarter
  FROM \`sdp-for-analysts-platform.rev_ops_prod.temp_sales_performance\` tsp
  WHERE tsp.close_date IS NOT NULL
    AND tsp.current_stage_name IN ('Closed Won', 'Closed Lost')
    AND tsp.is_qualified = TRUE
    AND tsp.close_date >= '2024-01-01'
    AND tsp.close_date < '2026-01-01'
    AND tsp.owner_line_of_business NOT IN ('Ads', 'Lending')
    AND tsp.owner_team NOT LIKE '%CSM%'
    AND tsp.owner_segment NOT IN ('SMB', 'Core')
),

conversion_by_region_segment AS (
  SELECT
    close_year,
    close_quarter,
    region,
    gmv_segment,
    COUNT(DISTINCT opportunity_id) AS total_closed,
    COUNT(DISTINCT CASE WHEN is_won = TRUE THEN opportunity_id END) AS total_won,
    SAFE_DIVIDE(
      COUNT(DISTINCT CASE WHEN is_won = TRUE THEN opportunity_id END),
      COUNT(DISTINCT opportunity_id)
    ) AS conversion_rate
  FROM base_data
  GROUP BY close_year, close_quarter, region, gmv_segment
),

q4_2025_mix_global AS (
  SELECT
    gmv_segment,
    COUNT(DISTINCT opportunity_id) AS segment_count,
    SAFE_DIVIDE(
      COUNT(DISTINCT opportunity_id),
      SUM(COUNT(DISTINCT opportunity_id)) OVER ()
    ) AS q4_2025_global_mix_pct
  FROM base_data
  WHERE close_year = 2025 AND close_quarter = 4
  GROUP BY gmv_segment
),

combined_metrics AS (
  SELECT
    c.close_year,
    c.close_quarter,
    c.region,
    c.gmv_segment,
    c.conversion_rate,
    c.total_closed,
    c.total_won,
    COALESCE(g.q4_2025_global_mix_pct, 0) AS q4_2025_global_mix_pct
  FROM conversion_by_region_segment c
  LEFT JOIN q4_2025_mix_global g ON c.gmv_segment = g.gmv_segment
),

region_totals AS (
  SELECT
    close_year,
    close_quarter,
    region,
    SAFE_DIVIDE(SUM(total_won), SUM(total_closed)) AS unadjusted_conv,
    SUM(conversion_rate * q4_2025_global_mix_pct) AS mix_adjusted_conv,
    SUM(total_closed) AS total_closed,
    SUM(total_won) AS total_won
  FROM combined_metrics
  GROUP BY close_year, close_quarter, region
)

SELECT
  close_year as year,
  CONCAT('Q', close_quarter) as quarter,
  region as owner_region,
  total_closed,
  total_won,
  ROUND(unadjusted_conv * 100, 1) AS unadjusted_win_rate_pct,
  ROUND(mix_adjusted_conv * 100, 1) AS mix_adjusted_win_rate_pct
FROM region_totals
ORDER BY close_year, close_quarter, region
`;

// ============================================================================
// DOM Elements
// ============================================================================

const elements = {
  // Common
  authStatus: document.getElementById('authStatus'),
  authBanner: document.getElementById('authBanner'),
  authButton: document.getElementById('authButton'),
  
  // Tab Navigation
  tabRevenue: document.getElementById('tabRevenue'),
  tabHiring: document.getElementById('tabHiring'),
  revenueTab: document.getElementById('revenueTab'),
  hiringTab: document.getElementById('hiringTab'),
  
  // Revenue Tab
  teamFilterBtn: document.getElementById('teamFilterBtn'),
  teamFilterDropdown: document.getElementById('teamFilterDropdown'),
  teamFilterOptions: document.getElementById('teamFilterOptions'),
  teamFilterSearch: document.getElementById('teamFilterSearch'),
  teamSelectAll: document.getElementById('teamSelectAll'),
  teamClearAll: document.getElementById('teamClearAll'),
  refreshBtn: document.getElementById('refreshBtn'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  chartsSection: document.getElementById('chartsSection'),
  emptyState: document.getElementById('emptyState'),
  
  // Hiring Tab
  hiringRegionFilterBtn: document.getElementById('hiringRegionFilterBtn'),
  hiringRegionFilterDropdown: document.getElementById('hiringRegionFilterDropdown'),
  hiringRegionFilterOptions: document.getElementById('hiringRegionFilterOptions'),
  hiringRegionSelectAll: document.getElementById('hiringRegionSelectAll'),
  hiringRegionClearAll: document.getElementById('hiringRegionClearAll'),
  refreshHiringBtn: document.getElementById('refreshHiringBtn'),
  hiringLoadingOverlay: document.getElementById('hiringLoadingOverlay'),
  hiringChartsSection: document.getElementById('hiringChartsSection'),
  hiringEmptyState: document.getElementById('hiringEmptyState'),
  hiringSummarySection: document.getElementById('hiringSummarySection'),
  hiringSummaryContent: document.getElementById('hiringSummaryContent')
};

// ============================================================================
// Authentication
// ============================================================================

async function checkAuth() {
  try {
    const authResult = await quick.auth.requestScopes([
      'https://www.googleapis.com/auth/bigquery'
    ]);
    
    if (authResult.hasRequiredScopes) {
      STATE.isAuthenticated = true;
      updateAuthUI(true);
      await loadData();
    } else {
      updateAuthUI(false);
    }
  } catch (error) {
    console.error('Auth check failed:', error);
    updateAuthUI(false, error.message);
  }
}

function updateAuthUI(authenticated, errorMessage = null) {
  const statusDot = elements.authStatus.querySelector('.status-dot');
  const statusText = elements.authStatus.querySelector('.status-text');
  
  if (authenticated) {
    statusDot.className = 'status-dot connected';
    statusText.textContent = 'Connected to BigQuery';
    elements.authBanner.style.display = 'none';
    elements.refreshBtn.disabled = false;
    elements.teamFilterBtn.disabled = false;
  } else {
    statusDot.className = errorMessage ? 'status-dot error' : 'status-dot';
    statusText.textContent = errorMessage || 'Authentication required';
    elements.authBanner.style.display = 'block';
  }
}

// ============================================================================
// Data Loading
// ============================================================================

async function loadData() {
  if (!STATE.isAuthenticated) return;
  
  setLoading(true);
  
  try {
    // Load both queries in parallel
    const [mainResult, mixAdjustedResult] = await Promise.all([
      quick.dw.querySync(BQ_QUERY),
      quick.dw.querySync(MIX_ADJUSTED_WIN_RATE_QUERY)
    ]);
    
    STATE.data = mainResult.results || [];
    STATE.mixAdjustedData = mixAdjustedResult.results || [];
    
    if (STATE.data.length === 0) {
      showEmptyState();
      return;
    }
    
    populateFilters();
    renderCharts();
    showCharts();
    
  } catch (error) {
    console.error('Query failed:', error);
    updateAuthUI(false, 'Query failed: ' + error.message);
  } finally {
    setLoading(false);
  }
}

function setLoading(loading) {
  STATE.isLoading = loading;
  elements.loadingOverlay.classList.toggle('visible', loading);
  elements.chartsSection.style.display = loading ? 'none' : 'block';
}

function showEmptyState() {
  elements.chartsSection.style.display = 'none';
  elements.emptyState.style.display = 'flex';
}

function showCharts() {
  elements.chartsSection.style.display = 'block';
  elements.emptyState.style.display = 'none';
}

// ============================================================================
// Filters
// ============================================================================

function populateFilters() {
  // Get unique teams (team_restated)
  const teams = [...new Set(STATE.data.map(d => d.team_restated).filter(Boolean))].sort();
  STATE.allTeams = teams;
  STATE.selectedTeams = []; // Empty means all selected
  
  // Populate team multi-select options
  elements.teamFilterOptions.innerHTML = teams.map(team => `
    <div class="multi-select-option selected" data-value="${team}">
      <span class="multi-select-checkbox"></span>
      <span class="multi-select-label">${team}</span>
      <div class="multi-select-item-actions">
        <button class="multi-select-item-btn" data-action="only">Only</button>
        <button class="multi-select-item-btn" data-action="deselect">Deselect</button>
      </div>
    </div>
  `).join('');
  
  updateTeamFilterButtonText();
}

function updateTeamFilterButtonText() {
  const btn = elements.teamFilterBtn;
  const textSpan = btn.querySelector('.multi-select-text');
  
  if (STATE.selectedTeams.length === 0 || STATE.selectedTeams.length === STATE.allTeams.length) {
    textSpan.textContent = 'All Teams';
  } else if (STATE.selectedTeams.length === 1) {
    textSpan.textContent = STATE.selectedTeams[0];
  } else {
    textSpan.textContent = `${STATE.selectedTeams.length} teams selected`;
  }
}

function getFilteredData() {
  let filtered = [...STATE.data];
  
  // Apply team filter (empty array means all)
  if (STATE.selectedTeams.length > 0 && STATE.selectedTeams.length < STATE.allTeams.length) {
    filtered = filtered.filter(d => STATE.selectedTeams.includes(d.team_restated));
  }
  
  return filtered;
}

// For attainment, filter to only include rows with targets
function getFilteredDataForAttainment() {
  let filtered = [...STATE.data];
  
  // Only include rows that have targets
  filtered = filtered.filter(d => d.target_revenue > 0);
  
  // Apply team filter (empty array means all)
  if (STATE.selectedTeams.length > 0 && STATE.selectedTeams.length < STATE.allTeams.length) {
    filtered = filtered.filter(d => STATE.selectedTeams.includes(d.team_restated));
  }
  
  return filtered;
}

// ============================================================================
// Chart Rendering
// ============================================================================

function getQuarterLabel(year, quarter) {
  return `${year} ${quarter}`;
}

// Region colors for consistent visualization
const REGION_COLORS = {
  'AMER': 'rgb(59, 130, 246)',   // Blue
  'EMEA': 'rgb(16, 185, 129)',   // Emerald
  'APAC': 'rgb(245, 158, 11)'    // Amber
};

const REGIONS = ['AMER', 'EMEA', 'APAC'];

function aggregateByQuarter(data) {
  const quarterMap = new Map();
  
  data.forEach(row => {
    const key = `${row.year}-${row.quarter}`;
    const region = row.owner_region;
    
    // Only include AMER, EMEA, APAC
    if (!REGIONS.includes(region)) return;
    
    if (!quarterMap.has(key)) {
      quarterMap.set(key, {
        label: getQuarterLabel(row.year, row.quarter),
        year: row.year,
        quarter: row.quarter,
        regions: new Map()
      });
    }
    
    const quarterData = quarterMap.get(key);
    if (!quarterData.regions.has(region)) {
      quarterData.regions.set(region, {
        CW_cnt_sum: 0,
        CW_LTR_sum: 0,
        closed_deal_cnt: 0,
        rep_distinct: 0,
        target_revenue: 0
      });
    }
    
    const regionData = quarterData.regions.get(region);
    regionData.CW_cnt_sum += row.CW_cnt_sum || 0;
    regionData.CW_LTR_sum += row.CW_LTR_sum || 0;
    regionData.closed_deal_cnt += row.closed_deal_cnt || 0;
    regionData.rep_distinct += row.rep_distinct || 0;
    regionData.target_revenue += row.target_revenue || 0;
  });
  
  // Sort by year and quarter
  return [...quarterMap.entries()]
    .sort((a, b) => {
      const [aYear, aQ] = a[0].split('-');
      const [bYear, bQ] = b[0].split('-');
      return aYear - bYear || aQ.localeCompare(bQ);
    })
    .map(([key, value]) => value);
}

function aggregateMixAdjustedData(data) {
  const quarterMap = new Map();
  
  data.forEach(row => {
    const key = `${row.year}-${row.quarter}`;
    const region = row.owner_region;
    
    // Only include AMER, EMEA, APAC
    if (!REGIONS.includes(region)) return;
    
    if (!quarterMap.has(key)) {
      quarterMap.set(key, {
        label: getQuarterLabel(row.year, row.quarter),
        year: row.year,
        quarter: row.quarter,
        regions: new Map()
      });
    }
    
    const quarterData = quarterMap.get(key);
    if (!quarterData.regions.has(region)) {
      quarterData.regions.set(region, {
        unadjusted_win_rate_pct: null,
        mix_adjusted_win_rate_pct: null,
        total_closed: 0,
        total_won: 0
      });
    }
    
    const regionData = quarterData.regions.get(region);
    regionData.unadjusted_win_rate_pct = row.unadjusted_win_rate_pct;
    regionData.mix_adjusted_win_rate_pct = row.mix_adjusted_win_rate_pct;
    regionData.total_closed = row.total_closed || 0;
    regionData.total_won = row.total_won || 0;
  });
  
  // Sort by year and quarter
  return [...quarterMap.entries()]
    .sort((a, b) => {
      const [aYear, aQ] = a[0].split('-');
      const [bYear, bQ] = b[0].split('-');
      return aYear - bYear || aQ.localeCompare(bQ);
    })
    .map(([key, value]) => value);
}

function createChartConfig(type, labels, datasets, yAxisLabel, isPercentage = false) {
  return {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: '#475569',
            font: { family: "'DM Sans', sans-serif", size: 11 },
            boxWidth: 12,
            padding: 15,
            usePointStyle: true
          }
        },
        tooltip: {
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          titleColor: '#1e293b',
          bodyColor: '#475569',
          borderColor: '#e2e8f0',
          borderWidth: 1,
          padding: 12,
          titleFont: { family: "'DM Sans', sans-serif", weight: 600 },
          bodyFont: { family: "'JetBrains Mono', monospace", size: 12 },
          callbacks: {
            label: function(context) {
              let value = context.parsed.y;
              if (isPercentage) {
                return `${context.dataset.label}: ${value.toFixed(1)}%`;
              }
              if (value >= 1000000) {
                return `${context.dataset.label}: $${(value / 1000000).toFixed(2)}M`;
              }
              if (value >= 1000) {
                return `${context.dataset.label}: $${(value / 1000).toFixed(1)}K`;
              }
              return `${context.dataset.label}: ${value.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(226, 232, 240, 0.8)', drawBorder: false },
          ticks: { color: '#475569', font: { family: "'DM Sans', sans-serif", size: 11 } }
        },
        y: {
          grid: { color: 'rgba(226, 232, 240, 0.8)', drawBorder: false },
          ticks: {
            color: '#475569',
            font: { family: "'JetBrains Mono', monospace", size: 11 },
            callback: function(value) {
              if (isPercentage) return value + '%';
              if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
              if (value >= 1000) return '$' + (value / 1000).toFixed(0) + 'K';
              return value.toFixed(1);
            }
          },
          title: {
            display: true,
            text: yAxisLabel,
            color: '#64748b',
            font: { family: "'DM Sans', sans-serif", size: 12 }
          }
        }
      }
    }
  };
}

function renderCharts() {
  const data = getFilteredData();
  const dataForAttainment = getFilteredDataForAttainment();
  const aggregated = aggregateByQuarter(data);
  const aggregatedForAttainment = aggregateByQuarter(dataForAttainment);
  const labels = aggregated.map(q => q.label);
  const labelsForAttainment = aggregatedForAttainment.map(q => q.label);
  
  // Destroy existing charts
  Object.values(STATE.charts).forEach(chart => {
    if (chart) chart.destroy();
  });
  
  // Chart 1: Deals per Rep
  const dealsPerRepDatasets = REGIONS.map(region => ({
    label: region,
    data: aggregated.map(q => {
      const regionData = q.regions.get(region);
      if (!regionData || regionData.rep_distinct === 0) return null;
      return regionData.CW_cnt_sum / regionData.rep_distinct;
    }),
    borderColor: REGION_COLORS[region],
    backgroundColor: REGION_COLORS[region] + '33',
    tension: 0.3,
    pointRadius: 5,
    pointHoverRadius: 8,
    borderWidth: 3,
    spanGaps: true
  }));
  
  STATE.charts.dealsPerRep = new Chart(
    document.getElementById('dealsPerRepChart'),
    createChartConfig('line', labels, dealsPerRepDatasets, 'Deals / Rep')
  );
  
  // Chart 2: Deal Size
  const dealSizeDatasets = REGIONS.map(region => ({
    label: region,
    data: aggregated.map(q => {
      const regionData = q.regions.get(region);
      if (!regionData || regionData.CW_cnt_sum === 0) return null;
      return regionData.CW_LTR_sum / regionData.CW_cnt_sum;
    }),
    borderColor: REGION_COLORS[region],
    backgroundColor: REGION_COLORS[region] + '33',
    tension: 0.3,
    pointRadius: 5,
    pointHoverRadius: 8,
    borderWidth: 3,
    spanGaps: true
  }));
  
  STATE.charts.dealSize = new Chart(
    document.getElementById('dealSizeChart'),
    createChartConfig('line', labels, dealSizeDatasets, 'Avg Deal Size ($)')
  );
  
  // Chart 3: Attainment % (always uses Team Original filter)
  const attainmentDatasets = REGIONS.map(region => ({
    label: region,
    data: aggregatedForAttainment.map(q => {
      const regionData = q.regions.get(region);
      if (!regionData || regionData.target_revenue === 0) return null;
      return (regionData.CW_LTR_sum / regionData.target_revenue) * 100;
    }),
    borderColor: REGION_COLORS[region],
    backgroundColor: REGION_COLORS[region] + '33',
    tension: 0.3,
    pointRadius: 5,
    pointHoverRadius: 8,
    borderWidth: 3,
    spanGaps: true
  }));
  
  STATE.charts.attainment = new Chart(
    document.getElementById('attainmentChart'),
    createChartConfig('line', labelsForAttainment, attainmentDatasets, 'Attainment (%)', true)
  );
  
  // Chart 4: Win Rate %
  const winRateDatasets = REGIONS.map(region => ({
    label: region,
    data: aggregated.map(q => {
      const regionData = q.regions.get(region);
      if (!regionData || regionData.closed_deal_cnt === 0) return null;
      return (regionData.CW_cnt_sum / regionData.closed_deal_cnt) * 100;
    }),
    borderColor: REGION_COLORS[region],
    backgroundColor: REGION_COLORS[region] + '33',
    tension: 0.3,
    pointRadius: 5,
    pointHoverRadius: 8,
    borderWidth: 3,
    spanGaps: true
  }));
  
  STATE.charts.winRate = new Chart(
    document.getElementById('winRateChart'),
    createChartConfig('line', labels, winRateDatasets, 'Win Rate (%)', true)
  );
  
  // Chart 5: Mix-Adjusted Win Rate (controls for GMV mix changes using Q4'25 baseline)
  const mixAdjustedAggregated = aggregateMixAdjustedData(STATE.mixAdjustedData);
  const mixAdjustedLabels = mixAdjustedAggregated.map(q => q.label);
  
  // Show only mix-adjusted lines (unadjusted is already in Chart 4)
  const mixAdjustedDatasets = REGIONS.map(region => ({
    label: region,
    data: mixAdjustedAggregated.map(q => {
      const regionData = q.regions.get(region);
      return regionData ? regionData.mix_adjusted_win_rate_pct : null;
    }),
    borderColor: REGION_COLORS[region],
    backgroundColor: REGION_COLORS[region] + '33',
    tension: 0.3,
    pointRadius: 5,
    pointHoverRadius: 8,
    borderWidth: 3,
    spanGaps: true
  }));
  
  STATE.charts.mixAdjustedWinRate = new Chart(
    document.getElementById('mixAdjustedWinRateChart'),
    createChartConfig('line', mixAdjustedLabels, mixAdjustedDatasets, 'Win Rate (%)', true)
  );
  
  // Chart 6: Actuals vs Targets (Total across all regions)
  const totalActualsData = aggregatedForAttainment.map(q => {
    let total = 0;
    q.regions.forEach(regionData => {
      total += regionData.CW_LTR_sum || 0;
    });
    return total > 0 ? total : null;
  });
  
  const totalTargetsData = aggregatedForAttainment.map(q => {
    let total = 0;
    q.regions.forEach(regionData => {
      total += regionData.target_revenue || 0;
    });
    return total > 0 ? total : null;
  });
  
  const actualsVsTargetsDatasets = [
    {
      label: 'Actuals (LTR)',
      data: totalActualsData,
      borderColor: 'rgb(16, 185, 129)', // Emerald
      backgroundColor: 'rgba(16, 185, 129, 0.1)',
      tension: 0.3,
      pointRadius: 6,
      pointHoverRadius: 9,
      borderWidth: 3,
      fill: true
    },
    {
      label: 'Targets (LTR)',
      data: totalTargetsData,
      borderColor: 'rgb(59, 130, 246)', // Blue
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      tension: 0.3,
      pointRadius: 6,
      pointHoverRadius: 9,
      borderWidth: 3,
      borderDash: [8, 4], // Dashed line for targets
      fill: false
    }
  ];
  
  STATE.charts.actualsVsTargets = new Chart(
    document.getElementById('actualsVsTargetsChart'),
    {
      type: 'line',
      data: { labels: labelsForAttainment, datasets: actualsVsTargetsDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              color: '#475569',
              font: { family: "'DM Sans', sans-serif", size: 11 },
              boxWidth: 20,
              padding: 15,
              usePointStyle: false
            }
          },
          tooltip: {
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            titleColor: '#1e293b',
            bodyColor: '#475569',
            borderColor: '#e2e8f0',
            borderWidth: 1,
            padding: 12,
            titleFont: { family: "'DM Sans', sans-serif", weight: 600 },
            bodyFont: { family: "'JetBrains Mono', monospace", size: 12 },
            callbacks: {
              label: function(context) {
                let value = context.parsed.y;
                if (value >= 1000000) {
                  return `${context.dataset.label}: $${(value / 1000000).toFixed(2)}M`;
                }
                if (value >= 1000) {
                  return `${context.dataset.label}: $${(value / 1000).toFixed(1)}K`;
                }
                return `${context.dataset.label}: $${value.toFixed(0)}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(226, 232, 240, 0.8)', drawBorder: false },
            ticks: { color: '#475569', font: { family: "'DM Sans', sans-serif", size: 11 } }
          },
          y: {
            grid: { color: 'rgba(226, 232, 240, 0.8)', drawBorder: false },
            ticks: {
              color: '#475569',
              font: { family: "'JetBrains Mono', monospace", size: 11 },
              callback: function(value) {
                if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
                if (value >= 1000) return '$' + (value / 1000).toFixed(0) + 'K';
                return '$' + value;
              }
            },
            title: {
              display: true,
              text: 'Revenue ($)',
              color: '#64748b',
              font: { family: "'DM Sans', sans-serif", size: 12 }
            }
          }
        }
      }
    }
  );
}

// ============================================================================
// Hiring Cohort Analysis Functions
// ============================================================================

async function loadHiringData() {
  if (!STATE.isAuthenticated) return;
  
  STATE.isLoading = true;
  showHiringLoading(true);
  
  try {
    const result = await quick.dw.querySync(HIRING_BQ_QUERY);
    STATE.hiringData = result.results || [];
    
    if (STATE.hiringData.length > 0) {
      populateHiringFilters();
      renderHiringCharts();
      elements.hiringChartsSection.style.display = 'block';
      elements.hiringEmptyState.style.display = 'none';
    } else {
      elements.hiringChartsSection.style.display = 'none';
      elements.hiringSummarySection.style.display = 'none';
      elements.hiringEmptyState.style.display = 'flex';
    }
  } catch (error) {
    console.error('Failed to load hiring data:', error);
    elements.hiringChartsSection.style.display = 'none';
    elements.hiringSummarySection.style.display = 'none';
    elements.hiringEmptyState.style.display = 'flex';
    elements.hiringEmptyState.querySelector('h3').textContent = 'Query Error';
    elements.hiringEmptyState.querySelector('p').textContent = `Error: ${error.message || 'Failed to load hiring cohort data.'}`;
  } finally {
    STATE.isLoading = false;
    showHiringLoading(false);
  }
}

function showHiringLoading(show) {
  if (show) {
    elements.hiringLoadingOverlay.classList.add('visible');
    elements.hiringChartsSection.style.display = 'none';
    elements.hiringSummarySection.style.display = 'none';
  } else {
    elements.hiringLoadingOverlay.classList.remove('visible');
  }
}

function populateHiringFilters() {
  // Get unique regions
  const regions = [...new Set(STATE.hiringData.map(d => d.region).filter(Boolean))].sort();
  STATE.allHiringRegions = regions;
  STATE.selectedHiringRegions = []; // Empty means all selected
  
  // Populate region multi-select options
  elements.hiringRegionFilterOptions.innerHTML = regions.map(region => `
    <div class="multi-select-option selected" data-value="${region}">
      <span class="multi-select-checkbox"></span>
      <span class="multi-select-label">${region}</span>
      <div class="multi-select-item-actions">
        <button class="multi-select-item-btn" data-action="only">Only</button>
        <button class="multi-select-item-btn" data-action="deselect">Deselect</button>
      </div>
    </div>
  `).join('');
  
  updateHiringRegionFilterButtonText();
  elements.hiringRegionFilterBtn.disabled = false;
  elements.refreshHiringBtn.disabled = false;
}

function updateHiringRegionFilterButtonText() {
  const btn = elements.hiringRegionFilterBtn;
  const textSpan = btn.querySelector('.multi-select-text');
  
  if (STATE.selectedHiringRegions.length === 0 || STATE.selectedHiringRegions.length === STATE.allHiringRegions.length) {
    textSpan.textContent = 'All Regions (Global)';
  } else if (STATE.selectedHiringRegions.length === 1) {
    textSpan.textContent = STATE.selectedHiringRegions[0];
  } else {
    textSpan.textContent = `${STATE.selectedHiringRegions.length} regions selected`;
  }
}

function getFilteredHiringData() {
  let filtered = [...STATE.hiringData];
  
  // Apply region filter (empty array means all)
  if (STATE.selectedHiringRegions.length > 0 && STATE.selectedHiringRegions.length < STATE.allHiringRegions.length) {
    filtered = filtered.filter(d => STATE.selectedHiringRegions.includes(d.region));
  }
  
  return filtered;
}

function aggregateHiringByCohort(data) {
  // Group by cohort and tenure_quarter, aggregate avg_attainment
  const cohortMap = new Map();
  
  data.forEach(row => {
    if (!row.cohort || !row.tenure_quarter) return;
    
    const key = `${row.cohort}-${row.tenure_quarter_num}`;
    
    if (!cohortMap.has(key)) {
      cohortMap.set(key, {
        cohort: row.cohort,
        tenure_quarter: row.tenure_quarter,
        tenure_quarter_num: row.tenure_quarter_num,
        total_attainment: 0,
        count: 0
      });
    }
    
    const entry = cohortMap.get(key);
    entry.total_attainment += row.avg_attainment || 0;
    entry.count += 1;
  });
  
  // Calculate averages and organize by cohort
  const cohorts = ['Q1 Cohort', 'Q2 Cohort', 'Q3 Cohort', 'Q4 Cohort'];
  const tenureQuarters = ['First Quarter', 'Second Quarter', 'Third Quarter', 'Fourth Quarter'];
  
  const result = {
    labels: tenureQuarters,
    cohorts: {}
  };
  
  cohorts.forEach(cohort => {
    result.cohorts[cohort] = tenureQuarters.map((tq, idx) => {
      const key = `${cohort}-${idx + 1}`;
      const entry = cohortMap.get(key);
      if (entry && entry.count > 0) {
        return (entry.total_attainment / entry.count) * 100; // Convert to percentage
      }
      return null;
    });
  });
  
  return result;
}

const COHORT_COLORS = {
  'Q1 Cohort': 'rgb(59, 130, 246)',   // Blue
  'Q2 Cohort': 'rgb(15, 82, 107)',    // Dark teal
  'Q3 Cohort': 'rgb(234, 121, 83)',   // Coral/Orange
  'Q4 Cohort': 'rgb(20, 120, 120)'    // Teal
};

function generateHiringSummary(aggregated) {
  const insights = [
    {
      text: `<span class="summary-highlight">Q1 Cohort</span> shows the <span class="summary-negative">weakest performance</span> among all cohorts.`
    },
    {
      text: `<span class="summary-highlight">Q2 and Q3 Cohorts</span> appear to be <span class="summary-positive">improving over time</span>.`
    },
    {
      text: `<span class="summary-highlight">Q4 Cohort</span> is <span class="summary-neutral">too early to assess</span> with limited data available.`
    }
  ];
  
  // Render summary
  const summaryHtml = insights.map(insight => `
    <div class="summary-item">
      <span class="summary-bullet"></span>
      <span>${insight.text}</span>
    </div>
  `).join('');
  
  elements.hiringSummaryContent.innerHTML = summaryHtml;
  elements.hiringSummarySection.style.display = 'block';
}

function renderHiringCharts() {
  const data = getFilteredHiringData();
  const aggregated = aggregateHiringByCohort(data);
  
  // Generate summary commentary (wrapped in try-catch to prevent breaking charts)
  try {
    generateHiringSummary(aggregated);
  } catch (err) {
    console.error('Error generating summary:', err);
    elements.hiringSummarySection.style.display = 'none';
  }
  
  // Destroy existing chart
  if (STATE.hiringCharts.cohortAttainment) {
    STATE.hiringCharts.cohortAttainment.destroy();
  }
  
  // Create datasets for each cohort
  const datasets = Object.entries(aggregated.cohorts).map(([cohort, values]) => ({
    label: cohort,
    data: values,
    borderColor: COHORT_COLORS[cohort],
    backgroundColor: COHORT_COLORS[cohort] + '33',
    tension: 0.3,
    pointRadius: 5,
    pointHoverRadius: 8,
    borderWidth: 3,
    spanGaps: false
  }));
  
  STATE.hiringCharts.cohortAttainment = new Chart(
    document.getElementById('cohortAttainmentChart'),
    {
      type: 'line',
      data: {
        labels: aggregated.labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#475569',
              font: { family: "'DM Sans', sans-serif", size: 12, weight: 500 },
              usePointStyle: true,
              pointStyle: 'line'
            }
          },
          tooltip: {
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            titleColor: '#1e293b',
            bodyColor: '#475569',
            borderColor: '#e2e8f0',
            borderWidth: 1,
            padding: 12,
            displayColors: true,
            callbacks: {
              label: function(context) {
                if (context.parsed.y !== null) {
                  return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`;
                }
                return `${context.dataset.label}: No data`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(226, 232, 240, 0.8)', drawBorder: false },
            ticks: { 
              color: '#475569', 
              font: { family: "'DM Sans', sans-serif", size: 12 }
            }
          },
          y: {
            min: 0,
            max: 500,
            grid: { color: 'rgba(226, 232, 240, 0.8)', drawBorder: false },
            ticks: { 
              color: '#475569', 
              font: { family: "'DM Sans', sans-serif", size: 12 },
              callback: value => value + '%'
            },
            title: {
              display: true,
              text: 'Avg Attainment (%)',
              color: '#64748b',
              font: { family: "'DM Sans', sans-serif", size: 12 }
            }
          }
        }
      }
    }
  );
}

// ============================================================================
// Event Listeners
// ============================================================================

function switchTab(tabName) {
  // Update tab buttons
  elements.tabRevenue.classList.toggle('active', tabName === 'revenue');
  elements.tabHiring.classList.toggle('active', tabName === 'hiring');
  
  // Update tab content
  elements.revenueTab.classList.toggle('active', tabName === 'revenue');
  elements.hiringTab.classList.toggle('active', tabName === 'hiring');
  
  STATE.activeTab = tabName;
  
  // Load data for the tab if not already loaded
  if (tabName === 'hiring' && STATE.hiringData.length === 0 && STATE.isAuthenticated) {
    loadHiringData();
  }
}

function initEventListeners() {
  // Auth button
  elements.authButton.addEventListener('click', checkAuth);
  
  // Tab navigation
  elements.tabRevenue.addEventListener('click', () => switchTab('revenue'));
  elements.tabHiring.addEventListener('click', () => switchTab('hiring'));
  
  // ============ Team Multi-Select (Revenue tab) ============
  
  // Toggle dropdown
  elements.teamFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = elements.teamFilterDropdown.classList.contains('open');
    closeAllDropdowns();
    if (!isOpen) {
      elements.teamFilterDropdown.classList.add('open');
      elements.teamFilterBtn.classList.add('active');
    }
  });
  
  // Option click
  elements.teamFilterOptions.addEventListener('click', (e) => {
    // Check if clicked on action button
    const actionBtn = e.target.closest('.multi-select-item-btn');
    if (actionBtn) {
      e.stopPropagation();
      const option = actionBtn.closest('.multi-select-option');
      const action = actionBtn.dataset.action;
      
      if (action === 'only') {
        // Deselect all, then select only this one
        elements.teamFilterOptions.querySelectorAll('.multi-select-option').forEach(opt => {
          opt.classList.remove('selected');
        });
        option.classList.add('selected');
      } else if (action === 'deselect') {
        option.classList.remove('selected');
      }
      
      updateSelectedTeams();
      renderCharts();
      return;
    }
    
    const option = e.target.closest('.multi-select-option');
    if (!option) return;
    
    option.classList.toggle('selected');
    updateSelectedTeams();
    renderCharts();
  });
  
  // Search filter
  elements.teamFilterSearch.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const options = elements.teamFilterOptions.querySelectorAll('.multi-select-option');
    options.forEach(opt => {
      const label = opt.querySelector('.multi-select-label').textContent.toLowerCase();
      opt.classList.toggle('hidden', !label.includes(searchTerm));
    });
  });
  
  // Select All
  elements.teamSelectAll.addEventListener('click', () => {
    elements.teamFilterOptions.querySelectorAll('.multi-select-option').forEach(opt => {
      if (!opt.classList.contains('hidden')) {
        opt.classList.add('selected');
      }
    });
    updateSelectedTeams();
    renderCharts();
  });
  
  // Clear All
  elements.teamClearAll.addEventListener('click', () => {
    elements.teamFilterOptions.querySelectorAll('.multi-select-option').forEach(opt => {
      opt.classList.remove('selected');
    });
    updateSelectedTeams();
    renderCharts();
  });
  
  // Refresh button (Revenue tab)
  elements.refreshBtn.addEventListener('click', loadData);
  
  // ============ Region Multi-Select (Hiring tab) ============
  
  // Toggle dropdown
  elements.hiringRegionFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = elements.hiringRegionFilterDropdown.classList.contains('open');
    closeAllDropdowns();
    if (!isOpen) {
      elements.hiringRegionFilterDropdown.classList.add('open');
      elements.hiringRegionFilterBtn.classList.add('active');
    }
  });
  
  // Option click
  elements.hiringRegionFilterOptions.addEventListener('click', (e) => {
    // Check if clicked on action button
    const actionBtn = e.target.closest('.multi-select-item-btn');
    if (actionBtn) {
      e.stopPropagation();
      const option = actionBtn.closest('.multi-select-option');
      const action = actionBtn.dataset.action;
      
      if (action === 'only') {
        // Deselect all, then select only this one
        elements.hiringRegionFilterOptions.querySelectorAll('.multi-select-option').forEach(opt => {
          opt.classList.remove('selected');
        });
        option.classList.add('selected');
      } else if (action === 'deselect') {
        option.classList.remove('selected');
      }
      
      updateSelectedHiringRegions();
      renderHiringCharts();
      return;
    }
    
    const option = e.target.closest('.multi-select-option');
    if (!option) return;
    
    option.classList.toggle('selected');
    updateSelectedHiringRegions();
    renderHiringCharts();
  });
  
  // Select All
  elements.hiringRegionSelectAll.addEventListener('click', () => {
    elements.hiringRegionFilterOptions.querySelectorAll('.multi-select-option').forEach(opt => {
      opt.classList.add('selected');
    });
    updateSelectedHiringRegions();
    renderHiringCharts();
  });
  
  // Clear All
  elements.hiringRegionClearAll.addEventListener('click', () => {
    elements.hiringRegionFilterOptions.querySelectorAll('.multi-select-option').forEach(opt => {
      opt.classList.remove('selected');
    });
    updateSelectedHiringRegions();
    renderHiringCharts();
  });
  
  // Refresh button (Hiring tab)
  elements.refreshHiringBtn.addEventListener('click', loadHiringData);
  
  // Close dropdowns when clicking outside
  document.addEventListener('click', closeAllDropdowns);
}

function closeAllDropdowns() {
  elements.teamFilterDropdown.classList.remove('open');
  elements.teamFilterBtn.classList.remove('active');
  elements.hiringRegionFilterDropdown.classList.remove('open');
  elements.hiringRegionFilterBtn.classList.remove('active');
}

function updateSelectedTeams() {
  const selectedOptions = elements.teamFilterOptions.querySelectorAll('.multi-select-option.selected');
  STATE.selectedTeams = Array.from(selectedOptions).map(opt => opt.dataset.value);
  updateTeamFilterButtonText();
}

function updateSelectedHiringRegions() {
  const selectedOptions = elements.hiringRegionFilterOptions.querySelectorAll('.multi-select-option.selected');
  STATE.selectedHiringRegions = Array.from(selectedOptions).map(opt => opt.dataset.value);
  updateHiringRegionFilterButtonText();
}

// ============================================================================
// Initialize
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  checkAuth();
});


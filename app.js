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
-- Base data with team_restated and GMV segment
WITH base_data AS (
  SELECT 
    tsp.opportunity_id,
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
    tsp.owner_segment,
    EXTRACT(year FROM tsp.close_date) as year,
    CONCAT('Q', EXTRACT(quarter FROM tsp.close_date)) as quarter,
    tsp.close_date,
    tsp.closed_won_lifetime_total_revenue,
    tsp.closed_won_opportunity_count,
    tsp.current_stage_name,
    tsp.is_qualified,
    tsp.is_won,
    tsp.salesforce_owner_id,
    tsp.closed_won_lifetime_total_revenue_target,
    -- GMV segment for mix-adjusted calculation
    CASE
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 5000000 THEN '0-5M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 10000000 THEN '5-10M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 20000000 THEN '10-20M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 40000000 THEN '20-40M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 75000000 THEN '40-75M'
      WHEN COALESCE(tsp.committed_d2c_gmv, 0) + COALESCE(tsp.committed_retail_gmv, 0) + COALESCE(tsp.committed_b2b_gmv, 0) < 150000000 THEN '75-150M'
      ELSE '150M+'
    END AS gmv_segment
  FROM \`sdp-for-analysts-platform.rev_ops_prod.temp_sales_performance\` tsp
  LEFT JOIN \`shopify-dw.sales.sales_opportunities_v1\` o ON tsp.opportunity_id = o.opportunity_id
  LEFT JOIN \`sdp-prd-commercial.mart.unified_account_list\` ual ON o.salesforce_account_id = ual.account_id
  WHERE tsp.close_date BETWEEN '2024-01-01' AND '2026-03-31'
    AND tsp.owner_line_of_business NOT IN ('Lending', 'Ads')
    AND tsp.owner_team NOT LIKE '%CSM%'
),

-- Q4 2025 global GMV mix (non-SMB only)
q4_2025_mix AS (
  SELECT
    gmv_segment,
    SAFE_DIVIDE(
      COUNT(DISTINCT opportunity_id),
      SUM(COUNT(DISTINCT opportunity_id)) OVER ()
    ) AS mix_pct
  FROM base_data
  WHERE year = 2025 AND quarter = 'Q4'
    AND current_stage_name IN ('Closed Won', 'Closed Lost')
    AND is_qualified = TRUE
    AND team_restated NOT IN ('D2C SMB Acquisition', 'Retail SMB Acquisition', 'D2C Retail SMB Cross-Sell')
  GROUP BY gmv_segment
),

-- Conversion rates by region/quarter/team/GMV segment (non-SMB only)
conversion_by_segment AS (
  SELECT
    owner_region,
    team_restated,
    year,
    quarter,
    gmv_segment,
    SAFE_DIVIDE(
      COUNT(DISTINCT CASE WHEN is_won = TRUE THEN opportunity_id END),
      COUNT(DISTINCT opportunity_id)
    ) AS segment_conv_rate
  FROM base_data
  WHERE current_stage_name IN ('Closed Won', 'Closed Lost')
    AND is_qualified = TRUE
    AND team_restated NOT IN ('D2C SMB Acquisition', 'Retail SMB Acquisition', 'D2C Retail SMB Cross-Sell')
  GROUP BY owner_region, team_restated, year, quarter, gmv_segment
),

-- Mix-adjusted win rate by region/quarter/team
mix_adjusted AS (
  SELECT
    c.owner_region,
    c.team_restated,
    c.year,
    c.quarter,
    ROUND(SUM(c.segment_conv_rate * COALESCE(m.mix_pct, 0)) * 100, 1) AS mix_adjusted_win_rate_pct
  FROM conversion_by_segment c
  LEFT JOIN q4_2025_mix m ON c.gmv_segment = m.gmv_segment
  GROUP BY c.owner_region, c.team_restated, c.year, c.quarter
),

-- Main aggregation
main_agg AS (
  SELECT 
    owner_region,
    team_restated,
    year,
    quarter,
    SUM(closed_won_lifetime_total_revenue) as CW_LTR_sum,
    SUM(closed_won_opportunity_count) as CW_cnt_sum,
    SUM(CASE WHEN current_stage_name IN ('Closed Won','Closed Lost') AND is_qualified = TRUE THEN 1 ELSE 0 END) as closed_deal_cnt,
    COUNT(DISTINCT CASE WHEN current_stage_name IN ('Closed Won','Closed Lost') THEN salesforce_owner_id END) as rep_distinct,
    SUM(closed_won_lifetime_total_revenue_target) as target_revenue
  FROM base_data
  GROUP BY owner_region, team_restated, year, quarter
)

SELECT 
  m.owner_region,
  m.team_restated,
  m.year,
  m.quarter,
  m.CW_LTR_sum,
  m.CW_cnt_sum,
  m.closed_deal_cnt,
  m.rep_distinct,
  m.target_revenue,
  -- Calculated metrics
  SAFE_DIVIDE(m.CW_cnt_sum, m.rep_distinct) as deals_per_rep,
  SAFE_DIVIDE(m.CW_LTR_sum, m.CW_cnt_sum) as deal_size,
  SAFE_DIVIDE(m.CW_LTR_sum, m.target_revenue) * 100 as attainment_pct,
  SAFE_DIVIDE(m.CW_cnt_sum, m.closed_deal_cnt) * 100 as win_rate_pct,
  ma.mix_adjusted_win_rate_pct
FROM main_agg m
LEFT JOIN mix_adjusted ma ON m.owner_region = ma.owner_region 
  AND m.team_restated = ma.team_restated 
  AND m.year = ma.year 
  AND m.quarter = ma.quarter
WHERE m.target_revenue > 0
ORDER BY m.owner_region, m.team_restated, m.year, m.quarter
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
    const result = await quick.dw.querySync(BQ_QUERY);
    STATE.data = result.results || [];
    
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
        target_revenue: 0,
        // For weighted mix-adjusted win rate
        mix_adjusted_weighted_sum: 0,
        mix_adjusted_weight: 0
      });
    }
    
    const regionData = quarterData.regions.get(region);
    regionData.CW_cnt_sum += row.CW_cnt_sum || 0;
    regionData.CW_LTR_sum += row.CW_LTR_sum || 0;
    regionData.closed_deal_cnt += row.closed_deal_cnt || 0;
    regionData.rep_distinct += row.rep_distinct || 0;
    regionData.target_revenue += row.target_revenue || 0;
    // Weighted average for mix-adjusted (weight by closed deals)
    if (row.mix_adjusted_win_rate_pct && row.closed_deal_cnt) {
      regionData.mix_adjusted_weighted_sum += row.mix_adjusted_win_rate_pct * row.closed_deal_cnt;
      regionData.mix_adjusted_weight += row.closed_deal_cnt;
    }
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
          min: 0,
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
  
  // Chart 5: Mix-Adjusted Win Rate (uses same filtered data, excludes 2026 Q1)
  // Filter to exclude 2026 Q1 for mix-adjusted chart
  const mixAdjustedAggregated = aggregated.filter(q => !(q.year === 2026 && q.quarter === 'Q1'));
  const mixAdjustedLabels = mixAdjustedAggregated.map(q => q.label);
  
  // Show mix-adjusted win rate (weighted average across selected teams)
  const mixAdjustedDatasets = REGIONS.map(region => ({
    label: region,
    data: mixAdjustedAggregated.map(q => {
      const regionData = q.regions.get(region);
      if (!regionData || regionData.mix_adjusted_weight === 0) return null;
      return regionData.mix_adjusted_weighted_sum / regionData.mix_adjusted_weight;
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
            min: 0,
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


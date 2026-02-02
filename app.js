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
    attainment: null
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
WITH teams as (
  SELECT 'Retail All' as old_team, 'D2C Retail Large' as new_team, 0.25 as target_multiplier
  UNION ALL SELECT 'Retail All', 'D2C Retail Mid-Mkt', 0.25
  UNION ALL SELECT 'Retail All', 'Retail SMB Acquisition', 0.25
  UNION ALL SELECT 'Retail All', 'D2C Retail SMB Cross-Sell', 0.25
  UNION ALL SELECT 'Retail SMB', 'D2C Retail Large', 0.25
  UNION ALL SELECT 'Retail SMB', 'D2C Retail Mid-Mkt', 0.25
  UNION ALL SELECT 'Retail SMB', 'Retail SMB Acquisition', 0.25
  UNION ALL SELECT 'Retail SMB', 'D2C Retail SMB Cross-Sell', 0.25
  UNION ALL SELECT 'Retail EMEA MM/LA Acquisition', 'D2C Retail Large', 0.25
  UNION ALL SELECT 'Retail EMEA MM/LA Acquisition', 'D2C Retail Mid-Mkt', 0.25
  UNION ALL SELECT 'Retail EMEA MM/LA Acquisition', 'Retail SMB Acquisition', 0.5
  UNION ALL SELECT 'Retail Large Mid-Mkt Acquisition', 'D2C Retail Large', 0.25
  UNION ALL SELECT 'Retail Large Mid-Mkt Acquisition', 'D2C Retail Mid-Mkt', 0.25
  UNION ALL SELECT 'Retail Large Mid-Mkt Acquisition', 'Retail SMB Acquisition', 0.5
  UNION ALL SELECT 'Retail EMEA Acquisition', 'D2C Retail Large', 0.25
  UNION ALL SELECT 'Retail EMEA Acquisition', 'D2C Retail Mid-Mkt', 0.25
  UNION ALL SELECT 'Retail EMEA Acquisition', 'Retail SMB Acquisition', 0.5
  UNION ALL SELECT 'Retail APAC Acquisition', 'D2C Retail Large', 0.25
  UNION ALL SELECT 'Retail APAC Acquisition', 'D2C Retail Mid-Mkt', 0.25
  UNION ALL SELECT 'Retail APAC Acquisition', 'Retail SMB Acquisition', 0.5
  UNION ALL SELECT 'Retail Acquisition', 'D2C Retail Large', 0.25
  UNION ALL SELECT 'Retail Acquisition', 'D2C Retail Mid-Mkt', 0.25
  UNION ALL SELECT 'Retail Acquisition', 'Retail SMB Acquisition', 0.5
  UNION ALL SELECT 'Retail Mid-Mkt Large Acquisition', 'D2C Retail Large', 0.25
  UNION ALL SELECT 'Retail Mid-Mkt Large Acquisition', 'D2C Retail Mid-Mkt', 0.25
  UNION ALL SELECT 'Retail Mid-Mkt Large Acquisition', 'Retail SMB Acquisition', 0.5
  UNION ALL SELECT 'Retail IRL', 'D2C Retail Large', 0.25
  UNION ALL SELECT 'Retail IRL', 'D2C Retail Mid-Mkt', 0.25
  UNION ALL SELECT 'Retail IRL', 'Retail SMB Acquisition', 0.5
  UNION ALL SELECT 'N3 Retail', 'D2C Retail Large', 0.25
  UNION ALL SELECT 'N3 Retail', 'D2C Retail Mid-Mkt', 0.25
  UNION ALL SELECT 'N3 Retail', 'Retail SMB Acquisition', 0.5
  UNION ALL SELECT 'Retail N3', 'D2C Retail Large', 0.25
  UNION ALL SELECT 'Retail N3', 'D2C Retail Mid-Mkt', 0.25
  UNION ALL SELECT 'Retail N3', 'Retail SMB Acquisition', 0.5
  UNION ALL SELECT 'Retail EMEA Cross-Sell', 'D2C Retail Large', 0.25
  UNION ALL SELECT 'Retail EMEA Cross-Sell', 'D2C Retail Mid-Mkt', 0.25
  UNION ALL SELECT 'Retail EMEA Cross-Sell', 'D2C Retail SMB Cross-Sell', 0.5
  UNION ALL SELECT 'Retail Cross-Sell', 'D2C Retail Large', 0.25
  UNION ALL SELECT 'Retail Cross-Sell', 'D2C Retail Mid-Mkt', 0.25
  UNION ALL SELECT 'Retail Cross-Sell', 'D2C Retail SMB Cross-Sell', 0.5
  UNION ALL SELECT 'Retail Mid-Mkt Large Cross-Sell', 'D2C Retail Large', 0.25
  UNION ALL SELECT 'Retail Mid-Mkt Large Cross-Sell', 'D2C Retail Mid-Mkt', 0.25
  UNION ALL SELECT 'Retail Mid-Mkt Large Cross-Sell', 'D2C Retail SMB Cross-Sell', 0.5
  UNION ALL SELECT 'Retail Large Mid-Mkt Cross-Sell', 'D2C Retail Large', 0.25
  UNION ALL SELECT 'Retail Large Mid-Mkt Cross-Sell', 'D2C Retail Mid-Mkt', 0.25
  UNION ALL SELECT 'Retail Large Mid-Mkt Cross-Sell', 'D2C Retail SMB Cross-Sell', 0.5
  UNION ALL SELECT 'Retail EMEA MM/LA Cross-Sell', 'D2C Retail Large', 0.25
  UNION ALL SELECT 'Retail EMEA MM/LA Cross-Sell', 'D2C Retail Mid-Mkt', 0.25
  UNION ALL SELECT 'Retail EMEA MM/LA Cross-Sell', 'D2C Retail SMB Cross-Sell', 0.5
),
final as (
  SELECT 
    tsp.owner_region,
    CASE
      WHEN teams.new_team IS NOT NULL THEN teams.new_team
      WHEN tsp.owner_team LIKE '%CSM%' THEN 'CSM MM LA Cross-Sell'
      WHEN tsp.owner_team IN ('B2B Acquisition','B2B Large Mid-Mkt Acquisition') THEN 'B2B Large Mid-Mkt Acquisition'
      WHEN tsp.owner_team IN ('B2B Cross-Sell') THEN 'B2B Large Mid-Mkt Cross-Sell'
      WHEN tsp.owner_team IN ('D2C Plus MM/LA Cross-Sell','D2C Cross-Sell','D2C Plus MM Cross-Sell','D2C Plus LA Cross-Sell','D2C Plus Cross-Sell','CSM MM','CSM LA','D2C Large Cross-Sell','D2C Mid-Mkt Cross-Sell','D2C Mid-Mkt Large Cross-Sell') THEN 'CSM MM LA Cross-Sell'
      WHEN tsp.owner_team IN ('D2C SMB Cross-Sell') THEN 'D2C Retail SMB Cross-Sell'
      WHEN tsp.owner_team IN ('Enterprise','Consumer Good','Diversified Industries','Food, Alcohol, & Beverage','Lifestyle','Manufacturing') THEN 'Enterprise'
      WHEN tsp.owner_team IN ('Global Account') THEN 'Global Account'
      WHEN tsp.owner_team IN ('D2C Large','Large Accounts') THEN 'D2C Retail Large'
      WHEN tsp.owner_team IN ('Lending Mid-Mkt Cross-Sell') THEN 'Lending Mid-Mkt Cross-Sell'
      WHEN tsp.owner_team IN ('Lending Mid-Mkt SMB Cross-Sell') THEN 'Lending Mid-Mkt SMB Cross-Sell'
      WHEN tsp.owner_team IN ('Lending SMB Cross-Sell') THEN 'Lending SMB Cross-Sell'
      WHEN tsp.owner_team IN ('D2C Mid-Mkt','D2C Mid-Mkt BPO','Mid Market','D2C Mid-Mkt N3','N3 Mid Market') THEN 'D2C Retail Mid-Mkt'
      WHEN tsp.owner_team IN ('Retail EMEA MM/LA Acquisition','Retail EMEA Acquisition','Retail APAC Acquisition','Retail Acquisition','Retail Mid-Mkt Large Acquisition','Retail Large Mid-Mkt Acquisition','Retail IRL','N3 Retail','Retail N3') AND IFNULL(o.annual_offline_revenue_usd,0) + IFNULL(o.annual_online_revenue_verified_usd,0) + IFNULL(o.incremental_annual_b2b_usd,0) >= 40000000 THEN 'D2C Retail Large'
      WHEN tsp.owner_team IN ('Retail EMEA Cross-Sell','Retail Cross-Sell','Retail APAC Cross-Sell','Retail Mid-Mkt Large Cross-Sell','Retail EMEA MM/LA Cross-Sell') AND IFNULL(ual.estimated_total_annual_revenue_usd,0) >= 40000000 THEN 'D2C Retail Large'
      WHEN tsp.owner_team IN ('Retail EMEA MM/LA Acquisition','Retail EMEA Acquisition','Retail APAC Acquisition','Retail Acquisition','Retail Mid-Mkt Large Acquisition','Retail Large Mid-Mkt Acquisition','Retail IRL','N3 Retail','Retail N3','D2C Mid-Mkt SMB') AND IFNULL(o.annual_offline_revenue_usd,0) + IFNULL(o.annual_online_revenue_verified_usd,0) + IFNULL(o.incremental_annual_b2b_usd,0) >= 5000000 THEN 'D2C Retail Mid-Mkt'
      WHEN tsp.owner_team IN ('Retail EMEA Cross-Sell','Retail Cross-Sell','Retail APAC Cross-Sell','Retail Mid-Mkt Large Cross-Sell','Retail EMEA MM/LA Cross-Sell') AND IFNULL(ual.estimated_total_annual_revenue_usd,0) >= 5000000 THEN 'D2C Retail Mid-Mkt'
      WHEN tsp.owner_team IN ('Retail EMEA MM/LA Acquisition','Retail EMEA Acquisition','Retail APAC Acquisition','Retail Acquisition','Retail Mid-Mkt Large Acquisition','Retail Large Mid-Mkt Acquisition','Retail IRL','N3 Retail','Retail N3','Retail SMB BPO','Retail EMEA SMB Acquisition') THEN 'Retail SMB Acquisition'
      WHEN tsp.owner_team IN ('D2C SMB Acquisition','D2C Mid-Mkt SMB') THEN 'D2C SMB Acquisition'
      WHEN tsp.owner_team IN ('Retail EMEA Cross-Sell','Retail Cross-Sell','Retail APAC Cross-Sell','Retail Mid-Mkt Large Cross-Sell','Retail EMEA MM/LA Cross-Sell','Retail EMEA SMB Cross-Sell') THEN 'D2C Retail SMB Cross-Sell'
      WHEN tsp.owner_team IN ('Retail SMB') AND tsp.owner_motion = 'Acquisition' THEN 'Retail SMB Acquisition'
      WHEN tsp.owner_team IN ('Retail SMB') THEN 'D2C Retail SMB Cross-Sell'
      WHEN tsp.owner_team IN ('Retail SMB Acquisition') THEN 'Retail SMB Acquisition'
      WHEN tsp.owner_team IN ('Retail SMB Cross-Sell') THEN 'D2C Retail SMB Cross-Sell'
      WHEN tsp.owner_team IN ('Retail Large Acquisition','Retail LA Acquisition') THEN 'D2C Retail Large'
      WHEN tsp.owner_team IN ('Retail Large Cross-Sell','Retail LA Cross-Sell') THEN 'D2C Retail Large'
      WHEN tsp.owner_team IN ('Retail Mid-Mkt Acquisition','Retail MM Acquisition') THEN 'D2C Retail Mid-Mkt'
      WHEN tsp.owner_team IN ('Retail Mid-Mkt Cross-Sell','Retail MM Cross-Sell') THEN 'D2C Retail Mid-Mkt'
      WHEN tsp.owner_team IN ('Retail All','Retail EMEA','Retail APAC') AND tsp.owner_motion = 'Acquisition' AND IFNULL(o.annual_offline_revenue_usd,0) + IFNULL(o.annual_online_revenue_verified_usd,0) + IFNULL(o.incremental_annual_b2b_usd,0) >= 40000000 THEN 'D2C Retail Large'
      WHEN tsp.owner_team IN ('Retail All','Retail EMEA','Retail APAC') AND tsp.owner_motion = 'Acquisition' AND IFNULL(o.annual_offline_revenue_usd,0) + IFNULL(o.annual_online_revenue_verified_usd,0) + IFNULL(o.incremental_annual_b2b_usd,0) >= 5000000 THEN 'D2C Retail Mid-Mkt'
      WHEN tsp.owner_team IN ('Retail All','Retail EMEA','Retail APAC') AND tsp.owner_motion = 'Acquisition' THEN 'Retail SMB Acquisition'
      WHEN tsp.owner_team IN ('Retail All','Retail EMEA','Retail APAC') AND IFNULL(ual.estimated_total_annual_revenue_usd,0) >= 40000000 THEN 'D2C Retail Large'
      WHEN tsp.owner_team IN ('Retail All','Retail EMEA','Retail APAC') AND IFNULL(ual.estimated_total_annual_revenue_usd,0) >= 5000000 THEN 'D2C Retail Mid-Mkt'
      WHEN tsp.owner_team IN ('Retail All','Retail EMEA','Retail APAC') THEN 'D2C Retail SMB Cross-Sell'
      ELSE tsp.owner_team
    END as owner_team_approach_1,
    EXTRACT(year FROM tsp.close_date) as year,
    CONCAT('Q', EXTRACT(quarter FROM tsp.close_date)) as quarter,
    SUM(tsp.closed_won_lifetime_total_revenue) as CW_LTR_sum,
    SUM(tsp.closed_won_opportunity_count) as CW_cnt_sum,
    COUNT(DISTINCT CASE WHEN tsp.current_stage_name IN ('Closed Won','Closed Lost') THEN tsp.salesforce_owner_id END) as rep_distinct,
    SUM(tsp.closed_won_lifetime_total_revenue_target * IFNULL(teams.target_multiplier,1)) as target_revenue,
    -- Calculated metrics
    SAFE_DIVIDE(SUM(tsp.closed_won_opportunity_count), COUNT(DISTINCT CASE WHEN tsp.current_stage_name IN ('Closed Won','Closed Lost') THEN tsp.salesforce_owner_id END)) as deals_per_rep,
    SAFE_DIVIDE(SUM(tsp.closed_won_lifetime_total_revenue), SUM(tsp.closed_won_opportunity_count)) as deal_size,
    SAFE_DIVIDE(SUM(tsp.closed_won_lifetime_total_revenue), SUM(tsp.closed_won_lifetime_total_revenue_target * IFNULL(teams.target_multiplier,1))) * 100 as attainment_pct
  FROM \`sdp-for-analysts-platform.rev_ops_prod.temp_sales_performance\` tsp
  LEFT JOIN teams ON tsp.owner_team = teams.old_team AND tsp.closed_won_lifetime_total_revenue_target > 0
  LEFT JOIN \`shopify-dw.sales.sales_opportunities_v1\` o ON tsp.opportunity_id = o.opportunity_id
  LEFT JOIN \`sdp-prd-commercial.mart.unified_account_list\` ual ON o.salesforce_account_id = ual.account_id
  WHERE tsp.owner_line_of_business NOT IN ('Ads','Lending')
    AND tsp.owner_team NOT IN ('Launch','Partner','Consumer Goods','Core Cross-Sell','Cross-Sell','Plus Cross-Sell Large Accounts','Plus Cross-Sell MM Assigned','Plus Cross-Sell MM Shared','Sales Concierge','Sales Incubation','Unknown','Plus Cross-Sell MM','Retail APAC','Retail EMEA','Plus Cross-Sell MMA/LA','Plus Cross-Sell MM Assigned/LA','CSM MM LA Cross-Sell','CSM Enterprise','CSM Global Account','CSM LA','CSM Large','CSM MM','CSM Mid-Mkt','CSM Unicorn','D2C Plus MM/LA Cross-Sell','D2C Cross-Sell','D2C Plus MM Cross-Sell','D2C Plus LA Cross-Sell','D2C Plus Cross-Sell','CSM MM','CSM LA','D2C Large Cross-Sell','D2C Mid-Mkt Cross-Sell','D2C Mid-Mkt Large Cross-Sell','Retail N3','N3 Retail')
    AND tsp.close_date BETWEEN '2024-01-01' AND '2026-03-31'
  GROUP BY ALL
)
SELECT *
FROM final
WHERE target_revenue > 0
ORDER BY owner_region, owner_team_approach_1, year, quarter
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
  // Get unique teams (owner_team_approach_1)
  const teams = [...new Set(STATE.data.map(d => d.owner_team_approach_1).filter(Boolean))].sort();
  STATE.allTeams = teams;
  STATE.selectedTeams = []; // Empty means all selected
  
  // Populate team multi-select options
  elements.teamFilterOptions.innerHTML = teams.map(team => `
    <div class="multi-select-option selected" data-value="${team}">
      <span class="multi-select-checkbox"></span>
      <span class="multi-select-label">${team}</span>
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
    filtered = filtered.filter(d => STATE.selectedTeams.includes(d.owner_team_approach_1));
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
    filtered = filtered.filter(d => STATE.selectedTeams.includes(d.owner_team_approach_1));
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
        rep_distinct: 0,
        target_revenue: 0
      });
    }
    
    const regionData = quarterData.regions.get(region);
    regionData.CW_cnt_sum += row.CW_cnt_sum || 0;
    regionData.CW_LTR_sum += row.CW_LTR_sum || 0;
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
  const cohorts = ['Q1 Cohort', 'Q2 Cohort', 'Q3 Cohort', 'Q4 Cohort'];
  const insights = [];
  
  // Calculate metrics for each cohort
  const cohortMetrics = {};
  cohorts.forEach(cohort => {
    const values = aggregated.cohorts[cohort] || [];
    const validValues = values.filter(v => v !== null && v !== undefined && !isNaN(v));
    
    if (validValues.length > 0) {
      const firstValidValue = validValues[0];
      const lastValidValue = validValues[validValues.length - 1];
      cohortMetrics[cohort] = {
        firstQuarter: firstValidValue,
        latestQuarter: lastValidValue,
        quartersOfData: validValues.length,
        avgAttainment: validValues.reduce((a, b) => a + b, 0) / validValues.length,
        trend: validValues.length > 1 ? lastValidValue - firstValidValue : 0
      };
    }
  });
  
  // Find best and worst performing cohorts in their first quarter
  const firstQuarterPerformers = Object.entries(cohortMetrics)
    .filter(([_, m]) => m.firstQuarter !== null && m.firstQuarter !== undefined && !isNaN(m.firstQuarter))
    .sort((a, b) => b[1].firstQuarter - a[1].firstQuarter);
  
  if (firstQuarterPerformers.length > 0) {
    const [bestCohort, bestMetrics] = firstQuarterPerformers[0];
    const [worstCohort, worstMetrics] = firstQuarterPerformers[firstQuarterPerformers.length - 1];
    
    insights.push({
      text: `<span class="summary-highlight">${bestCohort}</span> showed the strongest first-quarter performance at <span class="summary-positive">${bestMetrics.firstQuarter.toFixed(0)}%</span> attainment.`,
    });
    
    if (firstQuarterPerformers.length > 1 && worstCohort !== bestCohort) {
      const diff = bestMetrics.firstQuarter - worstMetrics.firstQuarter;
      insights.push({
        text: `<span class="summary-highlight">${worstCohort}</span> started at <span class="${worstMetrics.firstQuarter >= 100 ? 'summary-positive' : 'summary-neutral'}">${worstMetrics.firstQuarter.toFixed(0)}%</span>, a <span class="summary-neutral">${diff.toFixed(0)} percentage point</span> gap from ${bestCohort.replace(' Cohort', '')}.`,
      });
    }
  }
  
  // Analyze ramp-up trends for cohorts with multiple quarters
  const rampers = Object.entries(cohortMetrics)
    .filter(([_, m]) => m.quartersOfData > 1 && m.firstQuarter !== null && m.latestQuarter !== null)
    .sort((a, b) => b[1].trend - a[1].trend);
  
  if (rampers.length > 0) {
    const [fastestRamper, fastMetrics] = rampers[0];
    if (fastMetrics.trend > 0 && fastMetrics.firstQuarter !== null && fastMetrics.latestQuarter !== null) {
      insights.push({
        text: `<span class="summary-highlight">${fastestRamper}</span> demonstrated the strongest ramp-up, improving <span class="summary-positive">+${fastMetrics.trend.toFixed(0)} percentage points</span> from ${fastMetrics.firstQuarter.toFixed(0)}% to ${fastMetrics.latestQuarter.toFixed(0)}%.`,
      });
    }
    
    // Check for declining performers
    const decliners = rampers.filter(([_, m]) => m.trend < 0);
    if (decliners.length > 0) {
      const [decliner, declMetrics] = decliners[0];
      insights.push({
        text: `<span class="summary-highlight">${decliner}</span> showed a decline of <span class="summary-negative">${declMetrics.trend.toFixed(0)} percentage points</span>, suggesting potential onboarding or support gaps.`,
      });
    }
  }
  
  // Overall average comparison
  const avgByQuarter = {};
  aggregated.labels.forEach((label, idx) => {
    const values = cohorts.map(c => aggregated.cohorts[c]?.[idx]).filter(v => v !== null && v !== undefined);
    if (values.length > 0) {
      avgByQuarter[label] = values.reduce((a, b) => a + b, 0) / values.length;
    }
  });
  
  const quarterAvgs = Object.entries(avgByQuarter);
  if (quarterAvgs.length > 0) {
    const overallAvg = quarterAvgs.reduce((sum, [_, v]) => sum + v, 0) / quarterAvgs.length;
    const performanceLevel = overallAvg >= 100 ? 'summary-positive' : (overallAvg >= 80 ? 'summary-neutral' : 'summary-negative');
    insights.push({
      text: `Overall average attainment across all cohorts and tenure quarters is <span class="${performanceLevel}">${overallAvg.toFixed(0)}%</span>.`,
    });
  }
  
  // Render summary
  const summaryHtml = insights.map(insight => `
    <div class="summary-item">
      <span class="summary-bullet"></span>
      <span>${insight.text}</span>
    </div>
  `).join('');
  
  elements.hiringSummaryContent.innerHTML = summaryHtml || '<p>Insufficient data for analysis.</p>';
  elements.hiringSummarySection.style.display = insights.length > 0 ? 'block' : 'none';
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


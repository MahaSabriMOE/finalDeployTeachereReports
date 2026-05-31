// --- 1. GLOBAL VARIABLES & DB SETUP ---

const DB_NAME = "MyLocalDB";
const STORE_NAME = "records";
const COLUMNS_KEY = "db_columns"; // Key to store column names in localStorage

let db; // Our database object
let currentColumns = []; // Array to hold column names
let allRecords = []; // Array to hold ALL records fetched from DB
let tempConditionalNotes = {};
let currentPage = 1; // Current page number
const RECORDS_PER_PAGE = 15; // Number of records per page
let filteredRecords = []; // Array to hold records after search/filter
let currentLevelFilter = "الكل"; // Default filter state
let totalRecordsToImport = 0; // Global variable to store total records imported (excluding empty rows)
const searchInput = document.getElementById("search-input");
const searchButton = document.getElementById("btn-search");
// NEW: Global constant for academic year storage key
const ACADEMIC_YEAR_KEY = "academic_year_setting";

// NEW: Global constant for supervisor name storage key
const SUPERVISOR_NAME2_KEY = "supervisor_name2_setting";

// NEW: Global constant for supervisor name storage key
const DIRECTORATE_NAME_KEY = "directorate-name_setting";

// NEW: DOM Element for academic year input
const academicYearInput = document.getElementById("academic-year-input");
// NEW: DOM Element for supervisor name input
const supervisorName2Input = document.getElementById("supervisor-name2-input");

// NEW: DOM Element for supervisor name input
const directorateNameInput = document.getElementById("directorate-name-input");

// NEW: DOM Element for print teacher list button
const printTeacherListButton = document.getElementById(
  "btn-print-teacher-list"
);

// DOM Elements
const dataTableContainer = document.getElementById("data-table-container");
// NEW: DOM Element for conditional form (Add this near other global DOM elements)
const conditionalForm = document.getElementById("conditional-form"); // NEW

// DOM Element for the new filter
const levelFilter = document.getElementById("level-filter");

const formFields = document.getElementById("form-fields");
const recordIdInput = document.getElementById("record-id");
const printOutlet = document.getElementById("print-outlet");
const modal = document.getElementById("record-modal");
const modalDetailsContainer = document.getElementById(
  "modal-details-container"
);
const crudForm = document.getElementById("crud-form");
const formTitle = document.getElementById("form-title");
const cancelBtn = document.getElementById("btn-cancel");

// IndexedDB Setup
const request = indexedDB.open(DB_NAME, 1);

request.onerror = (event) => {
  console.error("Database error:", event.target.error);
};

request.onupgradeneeded = (event) => {
  db = event.target.result;
  let store;

  if (!db.objectStoreNames.contains(STORE_NAME)) {
    // 1. Create the store if it doesn't exist
    store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
  } else {
    // 2. If the store already exists (e.g., user is upgrading the app
    //    or refreshing a page with a fresh browser state),
    //    we get a reference to it.
    store = event.target.transaction.objectStore(STORE_NAME);
  }

  // 3. Clear all records in the store every time an upgrade (including
  //    the first creation) happens. This ensures it's always empty
  //    on what the browser considers a 'new' app instance or version.
  //    NOTE: This only runs if the version number is higher than the last time.
  //    For a *true* clean slate on every single load, you'd need to
  //    delete the whole DB first, but clearing the store here is the
  //    safest approach for fresh install/upgrade.
  try {
    store.clear();
    console.log(`Object store '${STORE_NAME}' cleared during upgrade.`);
  } catch (e) {
    console.warn(
      "Could not clear store. It might be locked or not fully created yet.",
      e
    );
  }

  // 4. Also clear the local storage for columns to ensure the UI
  //    is reset to the "Import Excel" state.
  localStorage.removeItem(COLUMNS_KEY);
};

request.onsuccess = (event) => {
  db = event.target.result;
  console.log("Database opened successfully.");
  loadColumns();
  loadAcademicYear(); // NEW: Load the academic year on startup
  // Restore totalRecordsToImport from localStorage
  const savedTotal = localStorage.getItem('totalRecordsToImport');
  if (savedTotal) {
    totalRecordsToImport = parseInt(savedTotal);
  }
  // Since we want the database to be empty and the user to be prompted
  // to import, we check if columns were loaded.
  if (currentColumns.length === 0) {
    // If no columns are loaded, it's a clean slate.
    // Show an instructional message and clear pagination.
    dataTableContainer.innerHTML =
      "<p>No data structure defined. Please import an Excel file to begin.</p>";
    renderPaginationControls(0);
    // Do NOT call loadData()
  } else {
    // If for some reason columns still exist, proceed to load data
    loadData();
  }
};

// --- SECURITY: HTML Escape Function ---
/**
 * Escapes HTML special characters to prevent XSS attacks.
 * @param {string} text - The text to escape.
 * @returns {string} - The escaped text safe for innerHTML.
 */
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, (char) => map[char]);
}

// --- SECURITY: Input Validation Function ---
/**
 * Validates and sanitizes form input.
 * @param {string} input - The user input to validate.
 * @returns {string} - The validated/sanitized input.
 */
function validateInput(input) {
  if (!input) return '';
  // Remove any HTML tags and trim whitespace
  return String(input).trim().replace(/<[^>]*>/g, '');
}

// --- 2. COLUMN MANAGEMENT ---

function loadColumns() {
  const storedColumns = localStorage.getItem(COLUMNS_KEY);
  if (storedColumns) {
    currentColumns = JSON.parse(storedColumns);
    buildForm();
  }
}

function saveColumns(columns) {
  currentColumns = columns;
  localStorage.setItem(COLUMNS_KEY, JSON.stringify(columns));
  buildForm();
}

/**
 * Determines the teacher's performance level based on the total score.
 * @param {number|string} totalScore - The teacher's total numeric score (0-100).
 * @returns {string} - The Arabic word for the performance level.
 */
function getTeacherLevel(totalScore) {
  const score = parseInt(totalScore);

  if (isNaN(score) || score < 0) {
    return "غير محدد"; // Not defined
  }

  if (score >= 85) {
    return "ممتاز"; // Excellent
  } else if (score >= 75) {
    // >=75 and <85
    return "جيد جدا"; // Very Good
  } else if (score >= 65) {
    // >=65 and <75
    return "جيد"; // Good
  } else if (score >= 55) {
    // >=55 and <65
    return "متوسط"; // average
  } else {
    // <55
    return "ضعيف"; // weak
  }
}

/**
 * Applies both the search term and the level filter to all records.
 */
function applyAllFilters() {
  const searchTerm = searchInput.value.trim().toLowerCase();

  // MODIFIED: Start with only imported records (using totalRecordsToImport boundary)
  let records = allRecords.slice(0, totalRecordsToImport);

  // 2. Apply Level Filter
  if (currentLevelFilter && currentLevelFilter !== "الكل") {
    records = records.filter((record) => {
      // Need a way to get the total score from the record for getTeacherLevel
      const totalScore = getMappedValue(record, "totalScoreNumeric", 0); // Assuming totalScoreNumeric is the mapping key
      const level = getTeacherLevel(totalScore);
      return level === currentLevelFilter;
    });
  }

  // 3. Apply Search Filter (on the already level-filtered records)
  if (searchTerm !== "") {
    records = records.filter((record) => {
      return currentColumns.some((col) => {
        const value = record[col];
        // Check if the column exists and contains the search term
        return String(value).toLowerCase().includes(searchTerm);
      });
    });
  }

  // 4. Update the global filtered array, reset page, and render
  filteredRecords = records;
  currentPage = 1;
  paginateAndRender();
}

/**
 * Sets the level filter and triggers the unified filtering logic.
 * @param {string} level - The level to filter by ('ممتاز', 'جيد', 'الكل', etc.).
 */
function filterByLevel(level) {
  currentLevelFilter = level; // Set the active filter
  updateLevelButtonStates(level); // Update button visual state
  applyAllFilters(); // Apply all current filters
}

/**
 * Updates the CSS class of the level filter buttons to show the active state.
 * @param {string} level - The current level filter (e.g., 'ممتاز', 'الكل').
 */
function updateLevelButtonStates(level) {
  // Get all buttons with the class 'filter-button'
  const buttons = document.querySelectorAll(".filter-button");

  buttons.forEach((button) => {
    // Read the level value from the data-level attribute on the button
    const buttonLevel = button.getAttribute("data-level");

    if (buttonLevel === level) {
      // Add the active class to the button that matches the selected level
      button.classList.add("active-filter");
    } else {
      // Remove the active class from all other buttons
      button.classList.remove("active-filter");
    }
  });
}

// --- Helper functions for settings (Place this near where ACADEMIC_YEAR is handled) ---

// Function to load settings from localStorage
function loadReportSettings() {
  // Load Academic Year (Existing Logic)
  const savedAcademicYear = localStorage.getItem(ACADEMIC_YEAR_KEY);
  if (academicYearInput && savedAcademicYear) {
    academicYearInput.value = savedAcademicYear;
  }

  // Load Supervisor Name (NEW)
  const savedSupervisorName2 = localStorage.getItem(SUPERVISOR_NAME2_KEY);
  if (supervisorName2Input && savedSupervisorName2) {
    supervisorName2Input.value = savedSupervisorName2;
  }

  // Load Directorate Name (NEW)
  const savedDirectorateName = localStorage.getItem(DIRECTORATE_NAME_KEY);
  if (directorateNameInput && savedDirectorateName) {
    directorateNameInput.value = savedDirectorateName;
  }
}

// Function to save settings to localStorage
function saveReportSettings() {
  // Save Academic Year (Existing Logic)
  if (academicYearInput) {
    localStorage.setItem(ACADEMIC_YEAR_KEY, validateInput(academicYearInput.value));
  }

  // Save Supervisor Name (NEW)
  if (supervisorName2Input) {
    localStorage.setItem(
      SUPERVISOR_NAME2_KEY,
      validateInput(supervisorName2Input.value)
    );
  }

  // Save Directorate Name (NEW)
  if (directorateNameInput) {
    localStorage.setItem(
      DIRECTORATE_NAME_KEY,
      validateInput(directorateNameInput.value)
    );
  }
}

// Function to get the supervisor name for printing (Access this function in your printing logic)
function getSupervisorName2() {
  // Returns the current value from the input field
  return supervisorName2Input ? supervisorName2Input.value.trim() : "";
}

function getDirectorateName() {
  // Returns the current value from the input field
  return directorateNameInput ? directorateNameInput.value.trim() : "";
}

// --- 2. INITIALIZATION AND EVENT LISTENERS (Call these during app setup) ---

// 1. Call this function when your app starts to load the saved values
loadReportSettings();

// 2. Add event listeners to save settings automatically on input change
if (academicYearInput) {
  academicYearInput.addEventListener("input", saveReportSettings);
}

// Add event listener for Supervisor Name (NEW)
if (supervisorName2Input) {
  supervisorName2Input.addEventListener("input", saveReportSettings);
}

// Add event listener for Directorate Name (NEW)
if (directorateNameInput) {
  directorateNameInput.addEventListener("input", saveReportSettings);
}

// --- NEW ACADEMIC YEAR LOGIC (for global report setting) ---

function loadAcademicYear() {
  const storedYear = localStorage.getItem(ACADEMIC_YEAR_KEY);
  // Only attempt to set the value if the input element exists
  if (academicYearInput && storedYear) {
    academicYearInput.value = storedYear;
  }
}

// Function to retrieve the globally saved academic year for use in reports
// You can call getAcademicYear() in your printing logic to get the value.
function getAcademicYear() {
  return academicYearInput
    ? academicYearInput.value.trim()
    : localStorage.getItem(ACADEMIC_YEAR_KEY) || "N/A";
}

function saveAcademicYear() {
  if (academicYearInput) {
    localStorage.setItem(ACADEMIC_YEAR_KEY, academicYearInput.value.trim());
  }
}

// Attach listener to save the value whenever the input changes/is typed into
if (academicYearInput) {
  academicYearInput.addEventListener("input", saveAcademicYear);
}

// --- END NEW ACADEMIC YEAR LOGIC ---

// --- NEW HELPER FUNCTIONS ---

/**
 * Checks if a column name suggests it's a date.
 * @param {string} colName
 * @returns {boolean}
 */
function isDateColumn(colName) {
  if (!colName) return false;
  return colName.toLowerCase().includes("date");
}

/**
 * Converts an Excel serial date number to a JS Date object.
 * @param {number} serial - The Excel serial number (e.g., 45584).
 * @returns {Date} - A JavaScript Date object.
 */
function convertExcelDate(serial) {
  // 25569 is the number of days from 1900-01-01 (Excel's epoch)
  // to 1970-01-01 (JavaScript's epoch), accounting for Excel's
  // "1900 was a leap year" bug.
  const daysSinceJSEpoch = serial - 25569;

  // Convert days to milliseconds
  const milliseconds = daysSinceJSEpoch * 24 * 60 * 60 * 1000;

  // Create a new Date object from the milliseconds
  return new Date(milliseconds);
}

/**
 * Formats a value if it's from a date column.
 * @param {*} value - The value from the DB (could be string, number, or Date object).
 * @param {string} colName - The column name.
 * @returns {string} - Formatted date (YYYY-MM-DD) or original value.
 */
function formatValue(value, colName) {
  if (!value) {
    return "N/A";
  }

  // If it's not a date column, just return the value
  if (!isDateColumn(colName)) {
    return value.toString();
  }

  let date;

  // Case 1: Value is a number (THE BUG!).
  // Any valid Excel date number will be greater than 25569 (which is 1970).
  if (typeof value === "number" && value >= 1) {
    date = convertExcelDate(value);
  }
  // Case 2: Value is already a Date object (from a correct import)
  else if (value instanceof Date) {
    date = value;
  }
  // Case 3: Value is a string like "YYYY-MM-DD" (from form input)
  else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parts = value.split("-");
    // new Date(year, monthIndex, day)
    date = new Date(parts[0], parts[1] - 1, parts[2]);
  }
  // Case 4: Other (invalid string, etc.)
  else {
    date = new Date(value); // This will likely be "Invalid Date"
  }

  // Check validity
  if (isNaN(date.getTime())) {
    return value.toString(); // Return original invalid value
  }

  // --- Date Formatting ---
  // We MUST use the UTC methods (getUTCFullYear, getUTCMonth, getUTCDate)
  // This ignores the user's local timezone and prevents "off-by-one-day"
  // bugs, which is crucial when dealing with Excel serial numbers.

  const year = date.getUTCFullYear();
  // getUTCMonth() is 0-indexed (0=Jan), so add 1
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * Gets the current date formatted as 'YYYY-MM-DD'.
 * @returns {string} - Today's date string.
 */
function getTodayFormattedDate() {
  const today = new Date();
  // Use standard methods (getFullYear, getMonth, getDate) for local 'today'
  const year = today.getFullYear();
  // getMonth() is 0-indexed (0=Jan), so add 1
  const month = (today.getMonth() + 1).toString().padStart(2, "0");
  const day = today.getDate().toString().padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * Converts a number (0-100) to its Arabic word representation.
 * This is used for the total score in the report.
 * @param {number|string} number - The score to convert.
 * @returns {string} - The Arabic word equivalent.
 */
function convertNumberToArabicWords(number) {
  const num = parseInt(number);

  if (isNaN(num) || num < 0) {
    return "قيمة غير صالحة"; // Invalid value
  }
  // Limit to 100 for this report
  if (num > 100) {
    return "أكبر من مئة";
  }

  if (num === 0) return "صفر";
  if (num === 100) return "مئة";

  // The core units, teens, and tens arrays for Arabic word conversion
  const units = [
    "",
    "واحد",
    "اثنان",
    "ثلاثة",
    "أربعة",
    "خمسة",
    "ستة",
    "سبعة",
    "ثمانية",
    "تسعة",
  ];
  const teens = [
    "عشرة",
    "أحد عشر",
    "اثنا عشر",
    "ثلاثة عشر",
    "أربعة عشر",
    "خمسة عشر",
    "ستة عشر",
    "سبعة عشر",
    "ثمانية عشر",
    "تسعة عشر",
  ];
  const tens = [
    "",
    "",
    "عشرون",
    "ثلاثون",
    "أربعون",
    "خمسون",
    "ستون",
    "سبعون",
    "ثمانون",
    "تسعون",
  ];

  let words = "";

  if (num < 10) {
    // 1-9
    words = units[num];
  } else if (num >= 10 && num < 20) {
    // 10-19
    words = teens[num - 10];
  } else {
    // 20-99
    const u = num % 10;
    const t = Math.floor(num / 10);

    if (u !== 0) {
      words += units[u];
      if (t > 1) {
        words += " و";
      }
    }
    if (t !== 0) {
      words += tens[t];
    }
  }

  return words.trim();
}

// --- 3. EXCEL IMPORT LOGIC ---

const fileInput = document.getElementById("excel-file-input");

fileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      // Add { cellDates: true } to auto-convert Excel dates to JS Date objects
      const json = XLSX.utils.sheet_to_json(worksheet, { cellDates: true });

      if (json.length > 0) {
        // Get columns (keys of the first object)
        const columns = Object.keys(json[0]).filter((col) => col.trim() !== "");

        if (!columns.includes("id")) {
          alert('Error: The imported file must contain a column named "id".');
          fileInput.value = "";
          return;
        }

        // Filter out empty rows (rows where the second column is empty)
        const filteredJson = json.filter((record) => {
          const secondColumn = columns[1];
          return record[secondColumn] && String(record[secondColumn]).trim() !== "";
        });

        // Ensure all IDs are numbers (IndexedDB requirement)
        const recordsToImport = filteredJson.map((record) => {
          record.id = Number(record.id);
          return record;
        });

        saveColumns(columns);
        importData(recordsToImport);
      }
    };
    reader.readAsArrayBuffer(file);
  }
});

function importData(records) {
  if (!db) return;

  // Calculate length from actual existing data and store in global variable
  totalRecordsToImport = records.length;
  // Persist to localStorage so it survives page reloads
  localStorage.setItem('totalRecordsToImport', totalRecordsToImport);

  const transaction = db.transaction([STORE_NAME], "readwrite");
  const store = transaction.objectStore(STORE_NAME);

  records.forEach((record) => {
    // Put attempts to add or update if the key (id) exists
    const request = store.put(record);
    request.onerror = (e) =>
      console.error("Error importing record:", e.target.error);
  });

  transaction.oncomplete = () => {
    console.log(`${totalRecordsToImport} records imported successfully!`);
    alert(`✓ تم استيراد ${totalRecordsToImport} سجل بنجاح!`); // Notify user with count
    loadData(); // Refresh the table
    fileInput.value = ""; // Clear the file input
    //openFormModal(null); // Ensure form is reset for new entry (Add mode)
  };
  transaction.onerror = (e) =>
    console.error("Import transaction error:", e.target.error);
}

// --- 4. CRUD FORM MANAGEMENT (Modal-based) ---

function buildForm() {
  formFields.innerHTML = ""; // Clear existing fields
  if (currentColumns.length === 0) {
    formFields.innerHTML =
      "<p>Import an Excel file to generate the form fields.</p>";
    return;
  }

  currentColumns.forEach((col) => {
    const type = col.toLowerCase().includes("date") ? "date" : "text";

    let labelText = col;
    let inputId = `field-${col}`;

    let html = `
            <div class="form-group">
                <label for="${inputId}">${labelText}:</label>
                <input type="${type}" id="${inputId}" required="${
      col === "id" ? "true" : "false"
    }">
            </div>
        `;
    formFields.innerHTML += html;
  });

  // Set the ID field to be read-only by default until resetForm/openFormModal updates it
  const idField = document.getElementById("field-id");
  if (idField) {
    idField.readOnly = false;
  }

  // Open the form modal in Add mode after columns are loaded
  // openFormModal(null);
}

// CREATE / UPDATE (Submit handler)
crudForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (currentColumns.length === 0) {
    alert("Please import an Excel file first to define the data structure.");
    return;
  }

  const newRecord = {};
  let isEdit = !!recordIdInput.value;

  currentColumns.forEach((col) => {
    const input = document.getElementById(`field-${col}`);
    let value = input ? input.value : "";

    if (col === "id") {
      newRecord[col] = Number(value); // Must be a number for keyPath
    } else {
      // SECURITY: Validate and sanitize all input values
      newRecord[col] = validateInput(value);
    }
  });

  if (isNaN(newRecord.id) || newRecord.id === 0) {
    alert("ID field is required and must be a number.");
    return;
  }

  if (!isEdit) {
    // Check for duplicate ID on creation
    const existingRecord = allRecords.find((r) => r.id === newRecord.id);
    if (existingRecord) {
      alert(
        `A record with ID ${newRecord.id} already exists. Please use a unique ID.`
      );
      return;
    }
  }

  const transaction = db.transaction([STORE_NAME], "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  const request = store.put(newRecord); // Uses put() to handle both create/update

  request.onsuccess = () => {
    console.log(`Record ${newRecord.id} saved.`);
    loadData(); // Reload all data and refresh the view
    closeModal(); // Close the form modal
  };

  request.onerror = (e) =>
    console.error("Error saving record:", e.target.error);
});

// Helper: Reset form after edit/create
function resetForm() {
  crudForm.reset();
  recordIdInput.value = "";
  formTitle.textContent = "إضافة سجل جديد"; // Update title to Arabic
  cancelBtn.textContent = "إلغاء"; // Update button text to Arabic

  // Make the 'id' field editable again
  const idField = document.getElementById("field-id");
  if (idField) {
    idField.readOnly = false;
  }

  // Ensure the main form is visible and the conditional form is hidden
  crudForm.classList.remove("hidden"); // Ensure main form is ready for normal CRUD
  if (conditionalForm) {
    conditionalForm.classList.add("hidden");
  }

  // Ensure the form is visible by default for Add mode
  crudForm.classList.remove("hidden-in-modal");
  modalDetailsContainer.classList.add("hidden-in-modal");
}

// --- 5. READ & RENDER (Pagination & Card View) ---

// READ (all)
function loadData() {
  if (!db) return;

  const transaction = db.transaction([STORE_NAME], "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const request = store.getAll();

  request.onsuccess = () => {
    // Store all records globally, sorted by ID
    allRecords = request.result.sort((a, b) => a.id - b.id);

    // MODIFIED: Initialize filteredRecords with only imported records (using totalRecordsToImport boundary)
    filteredRecords = allRecords.slice(0, totalRecordsToImport);

    // Render the current page
    paginateAndRender();

    // Populate the print range dropdowns
    populateRangeSelects(allRecords);
  };
  request.onerror = (e) => console.error("Error reading data:", e.target.error);
}

// Pagination Logic
function paginateAndRender() {
  // MODIFIED: Use only imported records (first totalRecordsToImport from filteredRecords)
  // This ensures consistency by excluding any empty/additional records
  const recordsToDisplay = filteredRecords.slice(0, totalRecordsToImport);
  const totalRecords = recordsToDisplay.length;
  const totalPages = Math.ceil(totalRecords / RECORDS_PER_PAGE);

  // Keep currentPage within bounds
  if (currentPage < 1) currentPage = 1;
  if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;

  // Calculate start and end indices for the current page
  const startIndex = (currentPage - 1) * RECORDS_PER_PAGE;
  const endIndex = startIndex + RECORDS_PER_PAGE;

  // Slice the recordsToDisplay array to get current page records
  const recordsOnPage = recordsToDisplay.slice(startIndex, endIndex);

  // 1. Render the cards for the current page
  renderTable(recordsOnPage);

  // 2. Render the pagination controls
  renderPaginationControls(totalPages);
}

function renderPaginationControls(totalPages) {
  const controlsContainer = document.getElementById("pagination-controls");

  controlsContainer.innerHTML = "";

  if (totalPages <= 1) {
    return;
  }

  let html = "";

  // Previous Button (Translated)
  html += `<button onclick="changePage(${currentPage - 1})" ${
    currentPage === 1 ? "disabled" : ""
  }>السابق</button>`;

  // Page Numbers
  // Simple rendering for brevity, can be enhanced with ellipses (...)
  for (let i = 1; i <= totalPages; i++) {
    const activeClass = i === currentPage ? "active-page" : "";
    html += `<button class="${activeClass}" onclick="changePage(${i})">${i}</button>`;
  }

  // Next Button (Translated)
  html += `<button onclick="changePage(${currentPage + 1})" ${
    currentPage === totalPages ? "disabled" : ""
  }>التالي</button>`;

  controlsContainer.innerHTML = html;
}

function changePage(newPage) {
  const totalPages = Math.ceil(allRecords.length / RECORDS_PER_PAGE);

  if (newPage >= 1 && newPage <= totalPages) {
    currentPage = newPage;
    paginateAndRender();
    // Optional: Scroll back to the top of the cards
    // dataTableContainer.scrollIntoView({ behavior: 'smooth' });
  }
}

// ==================================================================
// --- NEW: Configuration for data cards ---
// ==================================================================
// Define which columns to show on the card and what their labels are.
// This array controls the *order* of the fields on the card.
// - excelCol: The EXACT column name from your Excel file.
// - label: The friendly label you want to see on the card.
//
// ** YOU MUST EDIT THIS TO MATCH YOUR EXCEL FILE **
//
const CARD_DISPLAY_CONFIG = [
  { excelCol: "id", label: "الرقم" },
  { excelCol: "اسم المعلم", label: "اسم المعلم" },
  { excelCol: "رقم الهوية", label: "رقم الهوية" },
  { excelCol: "المدرسة", label: "المدرسة" },
  { excelCol: "الرقم الوطني", label: "الرقم الوطني" },
  { excelCol: "date", label: "تاريخ التعيين" },
  { excelCol: "المؤهل", label: "المؤهل" },
  { excelCol: "التخصص", label: "التخصص" },
  { excelCol: "العام الدراسي", label: "العام الدراسي" },
  // Add, remove, or reorder items here (up to ~7-8 fields recommended)
];
// ==================================================================

// Builds and displays the data card grid
// --- MODIFIED: Now uses CARD_DISPLAY_CONFIG and safe event delegation ---
function renderTable(records) {
  if (currentColumns.length === 0) {
    dataTableContainer.innerHTML =
      "<p>No data imported yet. Please import an Excel file.</p>";
    return;
  }

  if (records.length === 0) {
    dataTableContainer.innerHTML = "<p>لا تتوفر سجلات ضمن هذا التصنيف.</p>";
    return;
  }

  let html = "";
  
  // Display total imported records count
  if (totalRecordsToImport > 0) {
    html += `<div style="background-color: #f0f8ff; padding: 10px; margin-bottom: 15px; border-left: 4px solid #007bff; border-radius: 4px;">
                <strong>إجمالي السجلات المستوردة:</strong> ${totalRecordsToImport} سجل
              </div>`;
  }

  records.forEach((record) => {
    // SECURITY: Use data attribute instead of inline onclick
    html += `<div class="data-card" data-record-id="${record.id}" data-action="view-record">`;

    // --- NEW LOGIC ---
    // Loop through our config array to build the card face
    CARD_DISPLAY_CONFIG.forEach((item) => {
      const excelColName = item.excelCol;
      const displayLabel = item.label;

      // Check if this column exists in the record
      if (record.hasOwnProperty(excelColName)) {
        const rawValue = record[excelColName];
        // Use our formatter
        const formattedValue = formatValue(rawValue, excelColName);
        // SECURITY: Escape the formatted value
        const escapedValue = escapeHtml(formattedValue);

        // Special style for the ID
        if (excelColName === "id") {
          html += `<div class="card-id">${escapeHtml(displayLabel)}: ${escapedValue}</div>`;
        } else {
          // All other fields on the card face
          html += `
                        <div class="card-field">
                            <strong>${escapeHtml(displayLabel)}:</strong>
                            <span>${escapedValue}</span>
                        </div>
                    `;
        }
      }
    });
    // --- END NEW LOGIC ---
    // NEW: Display Teacher Level on the card
    const cardTotalScore = getMappedValue(record, "totalScoreNumeric", 0);
    const cardTeacherLevel = getTeacherLevel(cardTotalScore);

    // --- NEW CONDITIONAL BUTTON LOGIC ---
    const score = parseInt(cardTotalScore);
    let conditionalButtonHtml = "";
    // Condition: score > 85 OR score < 65
    if (!isNaN(score) && (score >= 85 || score <= 65)) {
      conditionalButtonHtml = `<button class="btn-conditional-action" data-record-id="${record.id}" data-action="conditional-action">
                                        فتح نموذج الملاحظات
                                    </button>`;
    }
    // --- END NEW CONDITIONAL BUTTON LOGIC ---

    html += `
            <div class="card-field card-level-tag">
                <strong>مستوى الأداء:</strong>
                <span style="font-weight: bold; color: #007bff;">${escapeHtml(cardTeacherLevel)}</span>
            </div>
            
        `;

    // Action buttons visible on the card (Translated)
    html += `
            <div class="card-actions">
            
                <button class="btn-edit" data-record-id="${record.id}" data-action="edit-record">إضافة ملاحظات المشرف</button>
                ${conditionalButtonHtml}
                <button class="btn-print-record" data-record-id="${record.id}" data-action="print-record">طباعة</button>
            </div>
        `;

    html += "</div>"; // close .data-card
  });

  dataTableContainer.innerHTML = html;
  
  // SECURITY: Add event delegation to handle all card actions safely
  setupCardEventListeners();
}

// SECURITY: Event delegation for card interactions
function setupCardEventListeners() {
  dataTableContainer.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-action], div[data-action="view-record"]');
    if (!button) return;
    
    const recordId = parseInt(button.getAttribute('data-record-id'));
    const action = button.getAttribute('data-action');
    
    if (isNaN(recordId)) return; // SECURITY: Validate recordId is a number
    
    switch(action) {
      case 'view-record':
        openViewModal(recordId);
        break;
      case 'edit-record':
        handleEdit(recordId);
        break;
      case 'conditional-action':
        handleConditionalAction(recordId, e);
        break;
      case 'print-record':
        handlePrintRecord(recordId);
        break;
    }
  });
}

// --- 6. MODAL (POPUP) FUNCTIONS ---

// 1. Opens the modal for VIEWING record details (from card click)
function openViewModal(id) {
  // SECURITY: Validate ID is a number
  const recordId = parseInt(id);
  if (isNaN(recordId)) return;
  
  // Hide the form, show the details container
  crudForm.classList.add("hidden-in-modal");
  modalDetailsContainer.classList.remove("hidden-in-modal");

  const record = allRecords.find((r) => r.id === recordId);

  if (!record) return;

  // Build HTML for ALL details
  let detailsHtml = `<h2>مزيد من التفاصيل (الرقم: ${escapeHtml(recordId)})</h2>`;

  currentColumns.forEach((col) => {
    // Use our new formatter
    const formattedValue = formatValue(record[col], col);
    // SECURITY: Escape both column name and value
    detailsHtml += `
            <div class="modal-field">
                <strong>${escapeHtml(col)}:</strong>
                <span>${escapeHtml(formattedValue)}</span>
            </div>
        `;
  });

  modalDetailsContainer.innerHTML = detailsHtml;
  modal.style.display = "block"; // Show the modal
}

// 2. Opens the modal for ADDING or EDITING a record
function openFormModal(record = null) {
  // Show the form, hide the details container
  crudForm.classList.remove("hidden-in-modal");
  modalDetailsContainer.classList.add("hidden-in-modal");
  // NEW: Ensure conditional form is hidden when opening the main form
  if (conditionalForm) {
    conditionalForm.classList.add("hidden");
    crudForm.classList.remove("hidden"); // Ensure main form is visible
  }

  if (record) {
    // EDIT MODE
    formTitle.textContent = "إضافة ملاحظات المشرف"; // Update title to Arabic
    cancelBtn.classList.remove("hidden");
    document.getElementById("field-id").readOnly = true;
    recordIdInput.value = record.id;

    // Populate the form fields
    currentColumns.forEach((col) => {
      const input = document.getElementById(`field-${col}`);
      if (input) {
        // If it's a date input, it needs the YYYY-MM-DD format
        if (input.type === "date") {
          if (record[col]) {
            // Use our formatter
            const formattedDate = formatValue(record[col], col);
            // Only set if the date was valid, otherwise leave it blank
            input.value = formattedDate !== "N/A" ? formattedDate : "";
          } else {
            input.value = ""; // Ensure it's blank if no date
          }
        } else {
          // For all other fields
          input.value = record[col] || "";
        }
      }
    });
  } else {
    // CREATE MODE
    resetForm();
    cancelBtn.classList.add("hidden"); // Hide cancel button for initial state
  }

  modal.style.display = "block"; // Show the modal
}

// NEW: Function to open the conditional form modal
function openConditionalFormModal(record) {
  // SECURITY: Validate record ID
  const recordId = parseInt(record.id);
  if (isNaN(recordId)) return;
  
  // Hide default form, show conditional form
  crudForm.classList.add("hidden"); // Hide the main CRUD form
  conditionalForm.classList.remove("hidden"); // Show the conditional form
  modalDetailsContainer.classList.add("hidden-in-modal"); // Keep details container hidden

  // Assuming 'اسم المعلم' is the column name for teacher's name
  const teacherName = escapeHtml(record["اسم المعلم"] || recordId);
  formTitle.textContent = `ملاحظات إضافية على أداء المعلم: ${teacherName}`;

  const conditionalFormFields = document.getElementById(
    "conditional-form-fields"
  );
  conditionalFormFields.innerHTML = ""; // Clear fields

  // Store the ID on the form element for submission reference
  conditionalForm.dataset.recordId = recordId;

  // Display teacher ID for context - SECURITY: Escape the ID
  conditionalFormFields.innerHTML += `<div class="form-group"><strong>رقم المعلم:</strong> ${escapeHtml(recordId)}</div>`;

  // 5 custom input fields (using Arabic labels)
  const inputLabels = [
    " مواطن القوة (إنجازات أو نشاطات أخرى يتميز بها ولم تشتمل عليها العناصر السابقة)",
    "مواطن الضعف  (جوانب سلبية يتصف بها وتؤثر على عمله دون أن يكون هناك تكرار للعناصر السابقة) ",
    " التوجهات و التوصيات العامة لتطوير قدراته  ( إن وجدت )",
    " رأي معد التقرير",
    " ملحوظات معتمد التقرير",
  ];

  inputLabels.forEach((label, index) => {
    const inputId = `conditional-field-${index}`;

    const html = `
            <div class="form-group">
                <label for="${inputId}">${escapeHtml(label)}:</label>
                <textarea  id="${inputId}" name="${inputId}" rows="4" style="width: 100%;"></textarea>
            </div>
        `;
    conditionalFormFields.innerHTML += html;
  });

  modal.style.display = "block"; // Show the modal
}

function closeModal() {
  modal.style.display = "none";
  resetForm(); // Ensure form resets when closed
}

// Close the modal if the user clicks anywhere outside of it
window.onclick = function (event) {
  if (event.target == modal) {
    closeModal();
  }
};

// --- 7. DELETE & EDIT HANDLERS ---

// DELETE
function handleDelete(id) {
  // SECURITY: Validate ID is a number
  const recordId = parseInt(id);
  if (isNaN(recordId)) return;
  
  if (!confirm(`Are you sure you want to delete record with ID: ${escapeHtml(recordId)}?`)) {
    return;
  }

  const transaction = db.transaction([STORE_NAME], "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  const request = store.delete(recordId);

  request.onsuccess = () => {
    console.log(`Record ${recordId} deleted.`);
    loadData(); // Reload data and refresh view
    closeModal(); // Ensure modal is closed
  };
  request.onerror = (e) =>
    console.error("Error deleting record:", e.target.error);
}

// UPDATE (Part 1: Populate form for editing)
function handleEdit(id) {
  // SECURITY: Validate ID is a number
  const recordId = parseInt(id);
  if (isNaN(recordId)) return;

  const record = allRecords.find((r) => r.id === recordId);
  if (!record) return;

  // Populate the form and open the modal
  openFormModal(record);
}

// NEW: Handler for the conditional button
function handleConditionalAction(id, event) {
  // SECURITY: Validate ID is a number
  const recordId = parseInt(id);
  if (isNaN(recordId)) return;
  
  const record = allRecords.find((r) => r.id === recordId);
  if (!record) return;

  openConditionalFormModal(record);
}

// --- 9. NEW CONDITIONAL FORM SUBMIT HANDLER (at the end of the file) ---

if (conditionalForm) {
  conditionalForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const recordId = Number(conditionalForm.dataset.recordId);
    
    // SECURITY: Validate recordId
    if (isNaN(recordId) || recordId <= 0) {
      alert("Invalid record ID.");
      return;
    }
    
    const inputLabels = [
      " مواطن القوة  (إنجازات أو نشاطات أخرى يتميز بها ولم تشتمل عليها العناصر السابقة)",
      "مواطن الضعف  (جوانب سلبية يتصف بها وتؤثر على عمله دون أن يكون هناك تكرار للعناصر السابقة) ",
      " التوجهات و التوصيات العامة لتطوير قدراته  ( إن وجدت )",
      " رأي معد التقرير",
      " ملحوظات معتمد التقرير",
    ];

    // 1. Gather the 5 input values and VALIDATE them
    const inputValues = inputLabels.map((label, index) => {
      const input = document.getElementById(`conditional-field-${index}`);
      // SECURITY: Validate and sanitize each input value
      return input ? validateInput(input.value) : "";
    });

    // Combine all 5 fields into the combinedNotes string for the report builder
    const combinedNotes = inputLabels
      .map((label, index) => `${label}: ${inputValues[index]}`)
      .join(" | ");
    const supervisorName = inputValues[4]; // Last field is supervisor name
    const todayDate = getTodayFormattedDate();

    const record = allRecords.find((r) => r.id === recordId);

    if (!record) {
      alert(`Error: Record with ID ${recordId} not found.`);
      return;
    }

    // 2. Store the notes TEMPORARILY
    tempConditionalNotes[recordId] = {
      combinedNotes: combinedNotes,
      supervisorName: supervisorName,
      supervisorDate: todayDate,
    };

    console.log(
      `Conditional Notes stored temporarily for Record ID ${recordId}.`
    );

    // 3. Close modal and print the SPECIAL REPORT
    closeModal();

    // ** NEW CALL: Print the dedicated special report **
    handlePrintSpecialReport(recordId);

    // 4. Clear the temporary notes AFTER a short delay
    setTimeout(() => {
      delete tempConditionalNotes[recordId];
      console.log(`Temporary notes cleared for ${recordId}.`);
    }, 3000);

    alert(
      `تم إعداد وطباعة تقرير الملاحظات الخاصة بنجاح للمعلم صاحب الرقم ${recordId}.`
    );
  });
}

// --- New: Export to Excel ---

function exportToExcel() {
  if (allRecords.length === 0) {
    alert("No data to export!");
    return;
  }

  // 1. Create a worksheet from the full array of records
  const worksheet = XLSX.utils.json_to_sheet(allRecords);

  // 2. Create a new workbook and append the worksheet
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Database Records");

  // 3. Write the workbook to a file and prompt download
  const filename = `Export_Records_${new Date()
    .toISOString()
    .slice(0, 10)}.xlsx`;
  XLSX.writeFile(workbook, filename);

  console.log("Data exported successfully.");
}

// Attach event listener for the export button
document
  .getElementById("btn-export-excel")
  .addEventListener("click", exportToExcel);
// --- New: Add Record Button Handler ---

document.getElementById("btn-add-record").addEventListener("click", () => {
  // Open the form modal in Create (Add New Record) mode
  openFormModal(null);
});

// --- 8. PRINTING LOGIC ---

// ==================================================================
// --- REPORT COLUMN MAPPING CONFIGURATION ---
// ==================================================================
//
// INSTRUCTION:
// Update the 'value' (the string on the right side) to match the
// EXACT column name from your Excel file.
// The 'key' (the name on the left side) MUST NOT be changed.
//
const REPORT_COLUMN_MAP = {
  // Metadata Fields
  teacherName: "اسم المعلم",
  teacherId: "رقم الهوية",
  qualification: "المؤهل",
  specialization: "التخصص",
  appointmentDate: "date",
  academicYear: "العام الدراسي",
  school: "المدرسة",
  nationalId: "الرقم الوطني",

  // Score Fields (score1 to score22)
  score1: "يوظف أسس المنهاج وخطوطه العريضة في العملية التعليمية التعلمية (5)",
  score2:
    "يتمكن من ربط الاهداف العامة للمنهاج مع أهداف المرحلة والاهداف الخاصة (7)",
  score3: "يتمكن من المحتوى التعليمي ويعمل على إثرائه (7)",
  score4: "يتمكن من الربط العمودي والافقي للمحتوى التعليمي وبشكل تكاملي (7)",
  score5: "يستخدم استراتيجيات تدريس متنوعة تتلاءم مع الموقف التعليمي التعلمي (7)",
  score6: "يعد الخطط ويطورها وفق أسس علمية (5)",
  score7:
    "يوظف تكنولوجيا  التعليم بأنواعها في العملية التعليمية التعلمية، وجاهيا أو افتراضيا( عن بعد) (4)",
  score8:
    "يوظف المنصات التعليمية الالكترونية ( البوابة التعليمية elearn )، وفضائية فلسطين التعليمية، لتعزيز تعلم الطلبة (4)",
  score9:
    "يوفر مناخا تعليميا آمنا وداعماً يمتاز بالمرونة، والابتكار، والتحفيز المستمر (6)",
  score10: "يوظف القياس والتقويم التربوي بأنواعه (6)",
  score11: "يكلف الطلبة بمهمات تعزز مهارات البحث العلمي ومهات القرائية (4)",
  score12: "يتمكن من ربط المبحث بسياقات حياتية وتعليمية واجتماعية متنوعة (6)",
  score13:
    "يوظف طرق التدريس بما ينسجم مع احتياجات الطلبة وقدراتهم وخصائصهم النمائية (6)",
  score14: "يدمج الطلبة ذوي الاحتياجات الخاصة في العملية التعليمية التعلمية (3)",
  score15: "يتمكن من اساسيات اللغة العربية والعلوم والرياضيات (3)",
  score16: "يعمق معرفته بالمحتوى العلمي، ويوجهها نحو زيادة الالمام بموضوع محدد (4)",
  score17:
    "يستثمر التغذية الراجعة الواردة من الجهات ذات العلاقة بالعملية التعليمية في تطوير أدائه (3)",
  score18: "يوظف مهارات الاتصال والتواصل في العملية التعليمية التعلمية (3)",
  score19:
    "يحرص على استمرارية نموه المهني، ويعد أبحاثا أو مبادرات في مجال تخصصه (4)",
  score20: "يلتزم بالأنظمة والقوانين واللوائح التربوية المعمول بها (2)",
  score21: "يشارك في اللجان المختلفة والأنشطة التربوية (2)",
  score22: "يحرص على بناء علاقات إنسانية مع الأطراف ذات العلاقة (2)",

  // Footer Fields
  totalScoreNumeric: "المجموع",
  totalScoreText: "المجموع بالحروف",
  reportDate: "التاريخ ", // Note: This key had a space in the original code
  supervisorNotes: "ملحوظات المشرف",
  supervisorDate: "تاريخ المشرف",
};
// ==================================================================

/**
 * Helper function to get mapped values for the report.
 * It uses REPORT_COLUMN_MAP to find the correct value in the record.
 * @param {object} record - The data record object.
 * @param {string} templateField - The internal name for the field (e.g., 'teacherName').
 * @param {string} [defaultValue='N/A'] - The value to return if not found.
 * @returns {string} - The formatted value from the record or the default.
 */
function getMappedValue(record, templateField, defaultValue = "N/A") {
  // 1. Find the actual Excel column name from our map
  const excelColName = REPORT_COLUMN_MAP[templateField];

  // 2. Check if that column name was defined in the map AND exists in the record
  if (excelColName && record.hasOwnProperty(excelColName)) {
    const value = record[excelColName];

    // 3. Check if this template field is a date that needs formatting
    // We use the 'templateField' name for this check
    if (["appointmentDate", "supervisorDate"].includes(templateField)) {
      // Pass the value AND the actual excelColName to the formatter
      return formatValue(value, excelColName) || defaultValue;
    }

    // 4. For score fields, default to an empty string '' instead of 'N/A'
    if (
      templateField.startsWith("score") ||
      templateField === "totalScoreNumeric"
    ) {
      // Numeric scores might be imported as numbers, ensure we return them directly
      if (value !== null && value !== undefined && value !== "") {
        return value;
      }
      defaultValue = "";
    }

    // 5. Return the value, or the default if it's empty/null
    return value !== null && value !== undefined && value !== ""
      ? value
      : defaultValue;
  }

  // 6. If mapping or column doesn't exist, return default
  // (Handle score default again in case the column doesn't exist at all)
  if (
    templateField.startsWith("score") ||
    templateField === "totalScoreNumeric"
  ) {
    defaultValue = "";
  }

  return defaultValue;
}

// Helper function to build HTML for a single record report
// --- MODIFIED: Uses getTodayFormattedDate() for reportDate field ---
function buildRecordReportHtml(record) {
  // 1. Calculate the score in Arabic words
  const totalNumericScore = getMappedValue(record, "totalScoreNumeric", 0);
  const totalScoreInArabic = convertNumberToArabicWords(totalNumericScore);
  // Check if temporary notes exist for this record ID
  const tempNotes = tempConditionalNotes[record.id];

  // Function to get the Supervisor Name from temporary notes or existing data
  const getSupervisorName = () => {
    // If temp notes exist, use the name from temp notes
    if (tempNotes && tempNotes.supervisorName) {
      return tempNotes.supervisorName;
    }
    // Otherwise, try to get it from the standard field (if you have one)
    // NOTE: Since your conditional form has a name, we will try to extract it from the combined notes
    const existingNotes = getMappedValue(record, "supervisorNotes", "");
    const supervisorMatch = existingNotes.match(
      /اسم المشرف:\s*(.+?)(?:\s*\||$)/
    );
    return supervisorMatch ? supervisorMatch[1].trim() : "N/A";
  };

  // --- HTML Structure matching the PDF (RTL) ---
  let html = `<div class="record-report-card">`;

  // 2. Header (Constants from PDF)
  html += `
  



  
  <div class="report-header-info">
            <div class="report-header-side report-header-right">
                <p><strong>دولة فلسطين</strong></p>
                <p><strong>وزارة التربية والتعليم العالي</strong></p>
                <p><strong>الادارة العامة للإشراف التربوي</strong></p>
            </div>

            <div class="report-header-title">
           <img src="./logo.png" class="logo-pic" />
           <br>
           <br>
            <p class="report-main-title">تقرير الاداء السنوى للمعلم / خاص بالمشرف التربوي</p>
          </div>

            <div class="report-header-side report-header-left">
<p><strong>مديرية التربية والتعليم :</strong> ${getDirectorateName()}</p>
        
        <p><strong>المدرسة :</strong> <span class="school-name-text">${getMappedValue(record, "school")}</span></p>

        <p><strong>الرقم الوطني :</strong> ${getMappedValue(
          record,
          "nationalId"
        )}</p>
            </div>
            
        </div>
        
    `;

  // 2. Metadata Table
  html += `
        <table class="report-metadata-table">
            <tr>
                <td class="label-cell">اسم المعلم /ة</td>
                <td class="value-cell">${getMappedValue(
                  record,
                  "teacherName"
                )}</td>
                <td class="label-cell">رقم الهوية</td>
                <td class="value-cell">${getMappedValue(
                  record,
                  "teacherId"
                )}</td>
            </tr>
            <tr>
                <td class="label-cell">المؤهل</td>
                <td class="value-cell">${getMappedValue(
                  record,
                  "qualification"
                )}</td>
                <td class="label-cell">التخصص</td>
                <td class="value-cell">${getMappedValue(
                  record,
                  "specialization"
                )}</td>
            </tr>
            <tr>
                <td class="label-cell">تاريخ التعيين</td>
                <td class="value-cell">${getMappedValue(
                  record,
                  "appointmentDate"
                )}</td>
                <td class="label-cell">العام الدراسي</td>
                <td class="value-cell">${getAcademicYear()}</td>
            </tr>
        </table>
    `;

  // 3. Performance Indicators Table
  html += `
        <table class="report-criteria-table">
            <thead>
                <tr>
                    <th class="col-1-area">المجال</th>
                    <th class"col-2-indicator">مؤشرات الاداء</th>
                    <th class="col-3-max-score">العلامة القصوى</th>
                    <th class="col-4-score">المعدل</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td rowspan="4" class="col-1-area">
                        المنهاج و المحتوى <br>
                                               
                    </td>
                    <td class="col-2-indicator">يوظف أسس المنهاج وخطوطه العريضة في العملية التعليمية التعلمية</td>
                    <td class="col-3-max-score">5</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score1"
                    )}</td>
                </tr>
                <tr>
                    <td class="col-2-indicator">يتمكن من ربط الأهداف العامة للمنهاج مع أهداف المرحلة والاهداف الخاصة</td>
                    <td class="col-3-max-score">7</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score2"
                    )}</td>
                </tr>
                <tr>
                    <td class="col-2-indicator">يتمكن من المحتوى التعليمي ويعمل على إثرائه</td>
                    <td class="col-3-max-score">7</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score3"
                    )}</td>
                </tr>
                <tr>
                    <td class="col-2-indicator">يتمكن من الربط العمودي والافقي للمحتوى التعليمي وبشكل تكاملي</td>
                    <td class="col-3-max-score">7</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score4"
                    )}</td>
                </tr>
                <tr>
                    <td rowspan="10" class="col-1-area">
                    البيداغوجيا العامة <br>
                    وبيداغوجيا المحتوى
                                               
                    </td>
                
                    <td class="col-2-indicator">يستخدم استراتيجيات تدريس متنوعة تتلاءم مع الموقف التعليمي التعلمي، موظفا المرافق المدرسية</td>
                    <td class="col-3-max-score">7</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score5"
                    )}</td>
                </tr>
                <tr>
                    <td class="col-2-indicator">يعد الخطط ويطورها وفق أسس علمية</td>
                    <td class="col-3-max-score">5</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score6"
                    )}</td>
                </tr>
                <tr>
                    <td class="col-2-indicator">يوظف تكنولوجيا التعليم بأنواعها في العملية التعليمية التعلمية، وجاهيا أو افتراضيا ( عن بعد)</td>
                    <td class="col-3-max-score">4</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score7"
                    )}</td>
                </tr>
                <tr>
                    <td class="col-2-indicator">يوظف المنصات التعليمية الالكترونية ( البوابة التعليمية elearn)، وفضائية فلسطين التعليمية، لتعزيز تعلم الطلبة</td>
                    <td class...col-3-max-score">4</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score8"
                    )}</td>
                </tr>
                <tr>
                    <td class="col-2-indicator">يوفر مناخا تعليميا آمنا وداعما يمتاز بالمرونة، والابتكار، والتحفيز المستمر.</td>
                    <td class="col-3-max-score">6</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score9"
                    )}</td>
                </tr>
                <tr>
                    <td class="col-2-indicator">يوظف القياس والتقويم التربوي بأنواعه</td>
                    <td class="col-3-max-score">6</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score10"
                    )}</td>
                </tr>
                <tr>
                    <td class="col-2-indicator">يكلف الطلبة بمهمات تعزز مهارات البحث العلمي ومهارات القرائية.</td>
                    <td class="col-3-max-score">4</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score11"
                    )}</td>
                </tr>
                <tr>
                    <td class="col-2-indicator">يتمكن من ربط المبحث بسياقات حياتية وتعليمية واجتماعية متنوعة.</td>
                    <td class="col-3-max-score">6</td>
                    <td class"col-4-score">${getMappedValue(
                      record,
                      "score12"
                    )}</td>
                </tr>
                <tr>
                    <td class="col-2-indicator">يوظف طرق التدريس بما ينسجم مع احتياجات الطلبة وقدراتهم وخصائصهم النمائية.</td>
                    <td class="col-3-max-score">6</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score13"
                    )}</td>
                </tr>
                <tr>
                    <td class="col-2-indicator">يدمج الطلبة ذوي الاحتياجات الخاصة في العملية التعليمية التعلمية</td>
                    <td class="col-3-max-score">3</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score14"
                    )}</td>
                </tr>

                <tr>
                    <td rowspan="5" class="col-1-area">
                      الكفايات الذاتية<br>
                                       
                    </td>
                
                    <td class="col-2-indicator">يتمكن من اساسيات اللغة العربية والعلوم والرياضيات</td>
                    <td class="col-3-max-score">3</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score15"
                    )}</td>
                </tr>
                <tr>
                    <td class="col-2-indicator">يعمق معرفته بالمحتوى العلمي، ويوجهها نحو زيادة الالمام بموضوع محدد.</td>
                    <td class="col-3-max-score">4</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score16"
                    )}</td>
                </tr>
                <tr>
                    <td class="col-2-indicator">يستثمر التغذية الواردة من الجهات ذات العلاقة بالعملية التعليمية في تطوير أدائه</td>
                    <td class="col-3-max-score">3</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score17"
                    )}</td>
                </tr>
                
                <tr>
                    
                    <td class="col-2-indicator">يوظف مهارات الاتصال والتواصل في العملية التعليمية التعلمية</td>
                    <td class="col-3-max-score">3</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score18"
                    )}</td>
                </tr>

                
                    <td class="col-2-indicator">يحرص على استمرارية نموه المهني، ويعد أبحاثا أو مبادرات في مجال تخصصه</td>
                    <td class"col-3-max-score">4</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score19"
                    )}</td>
                </tr>
                <tr>
                    <td rowspan="3" class="col-1-area">
                        أخلاقيات المهنة <br>
                        وقواعد السلوك
                    </td>
                
                    <td class="col-2-indicator">يلتزم بالأنظمة والقوانين واللوائح التربوية المعمول بها.</td>
                    <td class="col-3-max-score">2</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score20"
                    )}</td>
                </tr>
                
                <tr>
                    
                    <td class="col-2-indicator">يشارك في اللجان المختلفة والأنشطة التربوية.</td>
                    <td class="col-3-max-score">2</td>
                    <td class...col-4-score">${getMappedValue(
                      record,
                      "score21"
                    )}</td>
                </tr>
                <tr>
                    <td class="col-2-indicator">يحرص على بناء علاقات إنسانية مع الأطراف ذات العلاقة.</td>
                    <td class="col-3-max-score">2</td>
                    <td class="col-4-score">${getMappedValue(
                      record,
                      "score22"
                    )}</td>
                </tr>

                <tr>
                    <td colspan="2" style="font-weight: bold; text-align: center;">المجموع بالارقام</td>
                    <td class="col-3-max-score" style="font-weight: bold;">100</td>
                    <td class="col-4-score" style="font-weight: bold;">${totalNumericScore}</td>
                </tr>

            </tbody>
        </table>
    `;

  // 4. Footer Section

  //const totalNumericScore = getMappedValue(record, 'totalScoreNumeric', 0); // Need to re-fetch/use the numeric score
  const teacherLevel = getTeacherLevel(totalNumericScore); // Get the level
  html += `
        <div class="report-footer-section">
            <div class="report-footer-item">
           
                <span>التاريخ : ${getTodayFormattedDate()}</span>
                
            </div>
           
            <div class="report-footer-item align-left">
             <span>المجموع بالحروف : ${totalScoreInArabic}</span>
                
                               
            </div>


            <div class="report-footer-item">
                <span>ملحوظات المشرف و توصياته : ${getMappedValue(
                  record,
                  "supervisorNotes",
                  ""
                )}</span>
                
            </div>
        </div>

        <div class="report-footer-section">
         <div class="report-footer-item " style="font-weight: bold; margin-top: 15px;">
              <!-- <span>مستوى الأداء: ${teacherLevel}</span> -->
            </div>

            <div class="report-footer-signature">
             ${getMappedValue(record, "supervisorDate", "")}
            <span>اسم المشرف وتوقيعه :</span>
            <br>${getSupervisorName2()}
            
        </div>
        </div>

    `;

  html += "</div>"; // close .record-report-card
  return html;
}

// --- NEW: SPECIAL REPORT BUILDER ---

/**
 * Builds the HTML content for the special notes report.
 * @param {object} record - The main record data.
 * @param {object} notesData - The temporary notes object {combinedNotes, supervisorName, supervisorDate}.
 * @returns {string} - The HTML string for the printable report.
 */
function buildSpecialReportHtml(record, notesData) {
  // 1. Extract individual notes from the combined string (pipe separated)
  // The combinedNotes string is structured as: "L1: V1 | L2: V2 | L3: V3 | L4: V4 | L5: V5"
  const notesArray = notesData.combinedNotes.split(" | ");

  // Helper to safely get the value part from a "Label: Value" string
  const getValue = (str) => {
    if (!str) return "N/A";
    const parts = str.split(":");
    // If there's a colon, return the part after it, trimmed. Otherwise, return the whole string.
    return parts.length > 1 ? parts.slice(1).join(":").trim() : str.trim();
  };

  const note1 = getValue(notesArray[0]);
  const note2 = getValue(notesArray[1]);
  const recomm1 = getValue(notesArray[2]);
  const recomm2 = getValue(notesArray[3]);
  const recomm3 = getValue(notesArray[4]);
  // Note: The supervisor name is already in notesData.supervisorName

  const teacherName = getMappedValue(record, "teacherName");
  const teacherID = getMappedValue(record, "teacherId");
  const schoolName = getMappedValue(record, "school");

  // 2. Build the HTML structure (RTL, matching your image)
  let html = `
        <div class="special-report-card" style="border: 2px solid #333; padding: 20px; margin: 20px auto; max-width: 800px; direction: rtl; font-family: 'Arial', sans-serif;">
            
            <h2 style="text-align: center; border-bottom: 3px double #333; padding-bottom: 10px; margin-top: 0;">  نموذج التبرير <br> 
            خاص بالممتاز و المتوسط و الضعيف </h2>
            
            <div style="display: flex; justify-content: space-between;  ">
            <table style="width: 100%; border-collapse: collapse; ">
                <thead>
                
                    <tr style="background-color: #f0f0f0;">
                        <th style="border: 1px solid #333; padding: 10px; text-align: right; width: 50%;"><strong>اسم المعلم : </strong>${teacherName}</th>
                        <th style="border: 1px solid #333; padding: 10px; text-align: right; width: 50%;"><strong>هوية رقم : </strong>${teacherID}</th>
                         
                    </tr>
                </thead>
                <tbody>
                    <tr  style="background-color: #f0f0f0;">
                        <td style="border: 1px solid #333; padding: 10px; text-align: right; width: 50%;">
                            <strong>الوحدة الإدارية : </strong>مديرية التربية و التعليم / ${getDirectorateName()}
                            
                        </td>
                        <td style="border: 1px solid #333; padding: 10px; text-align: right; width: 50%;">
                       <strong>سنة التقييم : </strong>${getAcademicYear()}
                        </td>
                        
                    </tr>
                </tbody>
            </table>
            
                </div>
            

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
                <thead>
                
                    <tr style="background-color: #f0f0f0;">
                        <th style="border: 1px solid #333; padding: 10px; text-align: center; width: 100%;">مواطن قوة و مواطن ضعف ترى أهمية إضافتها</th>
                        
                    </tr>
                    
                </thead>
                 <tbody>
        <tr style="background-color: #a5a5a5ff; border: 1px solid #333;  text-align: center; width: 100%;">
            <td><p ><strong>${notesArray[0]
              .split(":")[0]
              .trim()}:</strong></p></td>
        </tr>
        <tr style="background-color: #ffffff; border: 1px solid #333; text-align: right; width: 100%;">
            <td style="padding: 15px; min-height: 80px;">${note1}</td>
        </tr>

        <tr style="background-color: #a5a5a5ff; border: 1px solid #333; text-align: center; width: 100%;">
            <td><p ><strong>${notesArray[1]
              .split(":")[0]
              .trim()}:</strong></p></td>
        </tr>
        <tr style="background-color: #ffffff; border: 1px solid #333; text-align: right; width: 100%;">
            <td style="padding: 15px; min-height: 80px;">${note2}</td>
        </tr>

        <tr style="background-color: #a5a5a5ff; border: 1px solid #333;  text-align: center; width: 100%;">
            <td><p ><strong>${notesArray[2]
              .split(":")[0]
              .trim()}:</strong></p></td>
        </tr>
        <tr style="background-color: #ffffff; border: 1px solid #333; text-align: right; width: 100%;">
            <td style="padding: 15px; min-height: 80px;">${recomm1}</td>
        </tr>

        <tr style="background-color: #a5a5a5ff; border: 1px solid #333;  text-align: center; width: 100%;">
            <td><p ><strong>${notesArray[3]
              .split(":")[0]
              .trim()}:</strong></p></td>
            
        </tr>
        <tr style="background-color: #ffffff; border: 1px solid #333; text-align: right; width: 100%;">
            <td style="padding: 15px; min-height: 80px;">${recomm2}
           <div class="details-group right-aligned">
            <p><strong>الاسم : ${getSupervisorName2()}</strong> </p>
            <p><strong>التوقيع:</strong> <span>&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;</span></p>
        </div>
        <div class="details-group left-aligned">
            <p><strong>الوظيفة:</strong> مشرف تربوي</p>
            <p><strong>التاريخ:</strong>&nbsp;&nbsp; /&nbsp;&nbsp; /&nbsp;&nbsp; م</p>
        </div>
            
            
            </td>
        </tr>

        <tr style="background-color: #f0f0f0; border: 1px solid #333;  text-align: center; width: 100%;">
            <td><p><strong>${notesArray[4]
              .split(":")[0]
              .trim()}:</strong></p></td>
        </tr>
        <tr style="background-color: #ffffff; border: 1px solid #333; text-align: right; width: 100%;">
            <td style="padding: 15px; min-height: 80px;">${recomm3}
            <div class="details-group right-aligned">
            <p><strong>الاسم : أ. :</strong> <span>&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp;</span></p>
            <p><strong>التوقيع:</strong> <span>&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;</span></p>
        </div>
        <div class="details-group left-aligned">
            <p><strong>الوظيفة:</strong> مدير عام التربية و التعليم </p>
            <p><strong>التاريخ:</strong>&nbsp;&nbsp;/ &nbsp;&nbsp;  / &nbsp;&nbsp;  م</p>
        </div>
            
            </tr>
    </tbody>
            </table>

            <div style="display: flex; justify-content: flex-start; gap: 50px; margin-top: 40px;">
                <p><strong>اسم المشرف:</strong> ${getSupervisorName2()}</p>
                <p><strong>تاريخ التقرير:</strong> ${
                  notesData.supervisorDate
                }</p>
                <p><strong>توقيع المشرف:</strong> _______________________</p>
            </div>
            
            <p style="text-align: center; margin-top: 50px; font-size: 0.9em; color: #555;">(هذا التقرير خاص بالملاحظات الإضافية ولا يلغي التقرير السنوي الرئيسي)</p>
        </div>
    `;

  return html;
}

/**
 * Executes the printing of the special report.
 * @param {number} id - The record ID.
 */
function handlePrintSpecialReport(id) {
  const record = allRecords.find((r) => r.id === id);
  const notesData = tempConditionalNotes[id];

  if (!record || !notesData) {
    alert("Data for special report not found. Please try again.");
    return;
  }

  // 1. Build the special report HTML
  printOutlet.innerHTML = buildSpecialReportHtml(record, notesData);

  // 2. Set print mode and print
  document.body.classList.add("printing-record"); // Use the same print class
  window.print();

  // 3. Clean up
  document.body.classList.remove("printing-record");
  printOutlet.innerHTML = "";
}

// Print single record
function handlePrintRecord(id) {
  event.stopPropagation(); // Stop card click from triggering view modal
  const record = allRecords.find((r) => r.id === id);

  if (!record) {
    alert("Record not found.");
    return;
  }

  printOutlet.innerHTML =
    `<h1>Record Report (ID: ${record.id})</h1>` + buildRecordReportHtml(record);

  // Set print mode and print
  document.body.classList.add("printing-record");
  window.print();

  // Clean up
  document.body.classList.remove("printing-record");
  printOutlet.innerHTML = "";
}

// Print full report (all records)
document.getElementById("btn-print").addEventListener("click", () => {
  let fullReportHtml = "<h1>تقارير جميع المعلمين</h1>";

  // Use totalRecordsToImport to iterate only over filled/imported records
  allRecords.slice(0, totalRecordsToImport).forEach((record) => {
    fullReportHtml += buildRecordReportHtml(record);
  });

  printOutlet.innerHTML = fullReportHtml;

  document.body.classList.add("printing-record");
  window.print();

  document.body.classList.remove("printing-record");
  printOutlet.innerHTML = "";
});

// Populate print range selectors with IDs
function populateRangeSelects(records) {
  const startSelect = document.getElementById("select-range-start");
  const endSelect = document.getElementById("select-range-end");

  startSelect.innerHTML = '<option value="">-- Select --</option>';
  endSelect.innerHTML = '<option value="">-- Select --</option>';

  if (records.length === 0) return;

  // Use totalRecordsToImport to iterate only over filled/imported records
  // Assuming records is sorted by ID
  records.slice(0, totalRecordsToImport).forEach((record) => {
    const option = `<option value="${record.id}">${record.id}</option>`;
    startSelect.innerHTML += option;
    endSelect.innerHTML += option;
  });
}

// Print selected range
document.getElementById("btn-print-range").addEventListener("click", () => {
  const startId = Number(document.getElementById("select-range-start").value);
  const endId = Number(document.getElementById("select-range-end").value);

  if (!startId || !endId) {
    alert("Please select both a start and end ID for the print range.");
    return;
  }

  if (startId > endId) {
    alert("Start ID cannot be greater than End ID.");
    return;
  }

  // Filter records for the range (since allRecords is already loaded and sorted)
  const recordsInRange = allRecords.filter(
    (r) => r.id >= startId && r.id <= endId
  );

  if (recordsInRange.length === 0) {
    alert("No records found in that ID range.");
    return;
  }

  let fullReportHtml = `<h1>Record Report (Range: ${startId} to ${endId})</h1>`;

  recordsInRange.forEach((record) => {
    fullReportHtml += buildRecordReportHtml(record);
  });

  printOutlet.innerHTML = fullReportHtml;

  document.body.classList.add("printing-record");
  window.print();

  document.body.classList.remove("printing-record");
  printOutlet.innerHTML = "";
});

// --- 9. CLEAR DATABASE ---

document.getElementById("btn-clear-db").addEventListener("click", () => {
  if (
    !confirm(
      "🔥 DANGER! 🔥\nThis will delete all data and columns. Are you sure?"
    )
  ) {
    return;
  }

  const transaction = db.transaction([STORE_NAME], "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  store.clear(); // Deletes all records

  transaction.oncomplete = () => {
    localStorage.removeItem(COLUMNS_KEY);
    localStorage.removeItem('totalRecordsToImport');
    currentColumns = [];
    allRecords = [];
    currentPage = 1;
    totalRecordsToImport = 0;
    dataTableContainer.innerHTML =
      "<p>No data imported yet. Please import an Excel file.</p>";
    formFields.innerHTML =
      "<p>Import an Excel file to generate the form fields.</p>";
    populateRangeSelects([]); // Clear dropdowns
    renderPaginationControls(0); // Clear pagination
    closeModal(); // Close any open modal
    alert("Database cleared successfully!");
  };
  transaction.onerror = (e) =>
    console.error("Error clearing database:", e.target.error);
});

// --- 10. SEARCH and Filter LOGIC ---

/*function performSearch() {
    const searchTerm = searchInput.value.trim().toLowerCase();
   

    if (searchTerm === '') {
        // If the search term is empty, show all records
        filteredRecords = [...allRecords];
    } else {
        // Filter all records based on the search term
        filteredRecords = allRecords.filter(record => {
            // Check if the search term exists in ANY field of the record
            return currentColumns.some(col => {
                const value = record[col];
                // Handle null/undefined values and ensure the value is a string for searching
                return String(value).toLowerCase().includes(searchTerm);
            });
        });
    }

    // Reset to the first page and render the results
    currentPage = 1;
    paginateAndRender();
}*/

// *** Refactor performSearch to just call the unified function: ***
function performSearch() {
  applyAllFilters();
}

// Attach event listeners
searchButton.addEventListener("click", performSearch);
searchInput.addEventListener("input", performSearch); // ADDED: Live search on input change

searchInput.addEventListener("keyup", (event) => {
  // Keep 'Enter' key press functionality
  if (event.key === "Enter") {
    performSearch();
  }
});

// Attach event listeners
searchButton.addEventListener("click", performSearch);
searchInput.addEventListener("input", performSearch); // ADDED: Live search on input change

searchInput.addEventListener("keyup", (event) => {
  // Keep 'Enter' key press functionality
  if (event.key === "Enter") {
    performSearch();
  }
});

// --- 10. BROWSER REFRESH ---

document.getElementById("btn-refresh-page").addEventListener("click", () => {
  // This function reloads the current page from the server/cache.
  window.location.reload();
  console.log("Refreshing browser...");
});

// --- 11. SUMMARY REPORT LOGIC ---

const summaryPrintOutlet = document.getElementById("summary-print-outlet");
const printSummaryButton = document.getElementById("btn-print-summary");

/**
 * Calculates the summary statistics based on score ranges and generates the report HTML.
 */
/**
 * Calculates the summary statistics based on score ranges and generates the report HTML.
 */
function generateSummaryReport() {
  // FIX 1: Check totalRecordsToImport (actual imported records) for data validity
  if (totalRecordsToImport === 0) {
    alert("لا توجد بيانات مستوردة لإنشاء التقرير الموجز.");
    return;
  }

  // Initialize counts
  const summary = {
    scoreA: 0, // ممتاز: >= 85
    scoreB: 0, // جيد جداً: >= 75 and < 85
    scoreC: 0, // جيد: >= 65 and < 75
    scoreD: 0, // متوسط: >= 55 and < 65
    scoreF: 0, // مقبول/ضعيف: < 55
  };

  // FIX 2 & 3: Iterate over allRecords and use getMappedValue for reliable score retrieval
  // All records in allRecords have already been filtered during import (empty rows removed)
  // Use totalRecordsToImport to explicitly iterate only over filled/imported records
  allRecords.slice(0, totalRecordsToImport).forEach((record) => {
    // Retrieve the score using the mapping key 'totalScoreNumeric'
    const totalScoreValue = getMappedValue(record, "totalScoreNumeric", 0);
    const score = parseFloat(totalScoreValue);

    // Skip invalid scores
    if (isNaN(score) || score < 0) return;

    // FIX 4: Simplified conditional structure (matching getTeacherLevel logic)
    if (score >= 85) {
      summary.scoreA++;
    } else if (score >= 75) {
      // >= 75 and < 85
      summary.scoreB++;
    } else if (score >= 65) {
      // >= 65 and < 75
      summary.scoreC++;
    } else if (score >= 55) {
      // >= 55 and < 65
      summary.scoreD++;
    } else if (score < 55) {
      // < 55
      summary.scoreF++;
    }
  });

  // The total number of teachers is totalRecordsToImport (records that passed import filter)
  const totalTeachers = totalRecordsToImport;
  const supervisorName = getSupervisorName2();
  const directorateName = getDirectorateName();
  const academicYear = getAcademicYear();

  // 5. Build the HTML structure (logic preserved from original snippet 21)
  const reportHTML = `
    <div class="summary-report-page">
    <div class="summary-report-header">
        <p>مديرية التربية والتعليم / ${directorateName}</p>
        <p>العام الدراسي: ${academicYear}</p>
        <h3>تقرير إحصائي موجز لنتائج تقييم المعلمين</h3>
    </div>
    <table class="summary-table">
        <thead>
        <tr>
            <th colspan="2">فئات التقدير وعدد المعلمين</th>
        </tr>
        </thead>
        <tbody>
        <tr>
            <td>عدد المعلمين بتقدير ممتاز (85 فأكثر)</td>
            <td>${summary.scoreA}</td>
        </tr>
        <tr>
            <td>عدد المعلمين بتقدير جيد جداً (75 - 84)</td>
            <td>${summary.scoreB}</td>
        </tr>
        <tr>
            <td>عدد المعلمين بتقدير جيد (65 - 74)</td>
            <td>${summary.scoreC}</td>
        </tr>
        <tr>
            <td>عدد المعلمين بتقدير متوسط (55 - 64)</td>
            <td>${summary.scoreD}</td>
        </tr>
        <tr>
            <td>عدد المعلمين بتقدير مقبول (54 فما دون)</td>
            <td>${summary.scoreF}</td>
        </tr>
        <tr class="total-row">
            <td><strong>العدد الكلي للمعلمين</strong></td>
            <td><strong>${totalTeachers}</strong></td>
        </tr>
        </tbody>
    </table>
    <div class="summary-report-footer">
        <p><strong>اسم المشرف:</strong> ${supervisorName}</p>
        <p><strong>التاريخ:</strong> ${new Date().toLocaleDateString("ar-EG", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}</p>
        <p><strong>التوقيع:</strong> .........................</p>
    </div>
    </div>
    `;

  // 6. Output to the new print container
  summaryPrintOutlet.innerHTML = reportHTML;

  // 7. Print logic
  // Assuming a printReport utility exists, otherwise use the original window.print() logic.
  // Based on the code structure, the original seems to rely on global print utilities.
  const content = summaryPrintOutlet.innerHTML;
  const printWindow = window.open("", "", "height=600,width=800");
  printWindow.document.write("<html><head><title>تقرير موجز</title>");
  printWindow.document.write(
    '<link rel="stylesheet" href="style.css" type="text/css" />'
  );
  printWindow.document.write("<style>");
  printWindow.document.write(
    ` /* Specific print style for summary */ .summary-report-page { max-width: 100%; margin: 0 auto; direction: rtl; padding: 20px; text-align: right; } /* Add styles for the table */ .summary-table { width: 100%; border-collapse: collapse; margin-top: 20px; } .summary-table th, .summary-table td { border: 1px solid #000; padding: 8px; } .summary-table th { background-color: #f2f2f2; text-align: center; } .total-row { font-weight: bold; background-color: #ddd; } .summary-report-header, .summary-report-footer { text-align: center; margin-bottom: 20px; } `
  );
  printWindow.document.write("</style></head><body>");
  printWindow.document.write(content);
  printWindow.document.write("</body></html>");
  printWindow.document.close();

  printWindow.onload = function () {
    printWindow.print();
    printWindow.close();
  };

  summaryPrintOutlet.innerHTML = "";
}

// Attach event listener to the new button
printSummaryButton.addEventListener("click", generateSummaryReport);

// --- NEW UTILITY: Generic Print Function ---
/**
 * Opens a new window, writes HTML content with print styles, and triggers the print dialog.
 * @param {string} content - The HTML content to print.
 * @param {string} title - The title of the print window.
 */
function printReport(content, title) {
  const printWindow = window.open("", "_blank");
  printWindow.document.write(
    '<!DOCTYPE html><html dir="rtl"><head><title>' + title + "</title>"
  );
  // Link to the main stylesheet for basic styles
  printWindow.document.write('<link rel="stylesheet" href="style.css">');
  printWindow.document.write("<style>");
  printWindow.document.write(`
        /* New print styles for the list report */
        .teacher-list-report {
            max-width: 1000px;
            margin: 20px auto;
            padding: 10px;
            font-family: 'Helvetica Neue', Arial, sans-serif;
            direction: rtl;
        }
        .data-list-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
            font-size: 0.9em;
        }
        .data-list-table th, .data-list-table td {
            border: 1px solid #333;
            padding: 8px;
            text-align: right;
        }
        .data-list-table th {
            background-color: #f2f2f2;
            text-align: center;
            font-weight: bold;
        }
        .report-header {
            text-align: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #000;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .report-header img {
            width: 80px; 
            height: auto; 
            margin-bottom: 10px;
        }
        .report-title-text {
            font-size: 1.5em;
        }
        @media print {
            /* Hide all main app content when printing the list report */
            body > *:not(.print-report-container) {
                display: none !important;
            }
            .print-report-container {
                display: block !important;
                page-break-after: avoid; 
                width: 100%;
                margin: 0;
            }
            .data-list-table {
                page-break-inside: auto;
            }
            .data-list-table tr {
                page-break-inside: avoid; 
                page-break-after: auto;
            }
            .report-header, footer {
                page-break-after: avoid;
                page-break-inside: avoid;
            }
        }
    `);
  printWindow.document.write("</style>");
  printWindow.document.write('</head><body dir="rtl">');
  printWindow.document.write(content);
  printWindow.document.write("</body></html>");

  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

/**
 * Generates and prints a dedicated report for the list of all teachers/records.
 * Prints only columns 1, 2, 3, 4, and 31 (indices 0, 1, 2, 3, 30).
 */
/**
 * Generates and prints a list report of all teachers with key columns and scores.
 */
function printTeacherListReport() {
  if (currentColumns.length === 0 || totalRecordsToImport === 0) {
    alert("لا توجد بيانات مستوردة لإنشاء تقرير القائمة.");
    return;
  }

  // 1. Define the columns to include in the list report
  // This is a subset of your full columns, used for the list view
  // You MUST edit this array to match the column names in your Excel file
  const reportColumns = ["id", "اسم المعلم", "رقم الهوية", "المدرسة"];
  // This array should match the list of fields you want to see in the table.

  const title = "تقرير قائمة المعلمين";
  const academicYear = localStorage.getItem(ACADEMIC_YEAR_KEY) || "غير محدد";
  const supervisorName =
    localStorage.getItem(SUPERVISOR_NAME2_KEY) || "غير محدد";
  const directorateName =
    localStorage.getItem(DIRECTORATE_NAME_KEY) || "غير محدد";

  const printOutlet = document.getElementById("print-teacher-list-outlet");
  printOutlet.innerHTML = ""; // Clear previous content

  // The name of the last column, which the user specified as "المجموع" (Total)
  // We assume the column containing the score is the last one in the loaded columns.
  const totalScoreColumnName = currentColumns[currentColumns.length - 2];

  // 1. Build the Header
  const headerHTML = `
        <div class="print-report-container teacher-list-report-container">
            <header class="report-header">
           
                <div class="report-title-text">مديرية التربية والتعليم - ${directorateName}</div>
                <div class="report-title-text">قسم التعليم المدرسي</div>
                <h2>${title}</h2>
                <div class="report-metadata">
                    <div>العام الدراسي: ${academicYear}</div>
                    <div>المشرف: ${supervisorName}</div>
                    <div>تاريخ الطباعة: ${new Date().toLocaleDateString(
                      "ar-EG",
                      { year: "numeric", month: "long", day: "numeric" }
                    )}</div>
                </div>
            </header>
            <main>
    `;

  // 2. Build the Table
  let tableHTML = `<table class="data-list-table"><thead><tr>`;

  // Add header for the list report (NO row number column)
  reportColumns.forEach((col) => {
    tableHTML += `<th>${col}</th>`;
  });

  // *** NEW COLUMN HEADER ***
  tableHTML += `<th>${totalScoreColumnName}</th>`; // Add the Score column header
  tableHTML += `<th>التقدير بالحروف</th>`; // Add the Level column header
  tableHTML += `</tr></thead><tbody>`;

  // Populate table rows
  // Use totalRecordsToImport to iterate only over filled/imported records
  allRecords.slice(0, totalRecordsToImport).forEach((record, index) => {
    // Calculate Level and Score
    const totalScore = getMappedValue(record, "totalScoreNumeric", 0); // Use mapped key to be safer
    const soreInArabic = convertNumberToArabicWords(totalScore);
    //const teacherLevel = getTeacherLevel(totalScore);

    let rowHTML = `<tr>`; // Start the row (NO row number cell)

    // Add data columns
    reportColumns.forEach((col) => {
      // Check if the column exists in the record
      const rawValue = record[col];
      // Use formatter for date columns
      const cellValue = formatValue(rawValue, col);
      rowHTML += `<td>${cellValue}</td>`;
    });

    // Add Score and Level columns
    rowHTML += `<td>${totalScore}</td>`;
    rowHTML += `<td>${soreInArabic}</td>`;

    rowHTML += `</tr>`;
    tableHTML += rowHTML;
  });

  tableHTML += `</tbody></table>`;

  // 3. Close tags and create Footer
  const footerHTML = `
            </main>
            <!--<footer style="margin-top: 20px; text-align: center; font-size: 0.8em; border-top: 1px solid #ccc; padding-top: 10px;">
                <p><strong>تم طباعة هذا التقرير من نظام تقييم المعلمين.</strong></p>
            </footer>-->
        </div>
    `;

  // 4. Combine and output
  printOutlet.innerHTML = headerHTML + tableHTML + footerHTML;

  // 5. Trigger Print (Using a new window for better control over print CSS)
  const titleForPrint = "تقرير قائمة المعلمين";

  // Define the style content directly here, as linking style.css in a new window
  // might be complicated/blocked in some environments.
  const styleContent = `
        /* Basic styles for print */
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            color: #000;
        }
        .teacher-list-report-container {
            max-width: 1000px;
            margin: 20px auto;
            padding: 10px;
            direction: rtl;
        }
        .data-list-table {
            width: 100%;
            border-collapse: collapse;
            border: 1px solid #333;
            margin-top: 15px;
            font-size: 0.9em;
        }
        .data-list-table th, .data-list-table td {
            border: 1px solid #333;
            padding: 8px;
            text-align: right;
        }
        .data-list-table th {
            background-color: #f2f2f2;
            text-align: center;
            font-weight: bold;
        }
        .report-header {
            text-align: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #000;
            /* تم حذف: display: flex; و flex-direction: column; و align-items: center; */
        }
        .report-header img {
            width: 80px;
            height: auto;
            margin-bottom: 10px;
        }
        .report-title-text {
            font-size: 1.2em;
        }
        margin-top: 15px;
            text-align: right;
            padding: 0 10px; 
            width: 95%; /* استخدم 95% أو 100% ولكن يفضل أقل من 100% قليلا لتجنب مشاكل الهوامش */
            margin-left: auto; /* لضمان محاذاة البيانات الوصفية لليسار في RTL */
            margin-right: auto;
            /* تأكد من تطبيق الـ Flexbox للعرض في 3 أعمدة */
            display: flex;
            justify-content: space-between; 
        }
        .report-metadata > div {
            white-space: nowrap; 
        }
            
        @media print {
            /* Hide all main app content when printing the list report */
            body > *:not(.teacher-list-report-container) {
                display: none !important;
            }
            .teacher-list-report-container {
                display: block !important;
                page-break-after: avoid; 
                width: 100%;
                margin: 0;
            }
            .data-list-table {
                page-break-inside: auto;
            }
            .data-list-table tr {
                page-break-inside: avoid; 
                page-break-after: auto;
            }
            .report-header, footer {
                page-break-after: avoid;
                page-break-inside: avoid;
            }
        }
    `;

  const printWindow = window.open("", "_blank");
  printWindow.document.write(
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><title>' +
      title +
      "</title>"
  );
  printWindow.document.write("<style>" + styleContent + "</style>");
  printWindow.document.write('</head><body dir="rtl">');
  printWindow.document.write(printOutlet.innerHTML);
  printWindow.document.write("</body></html>");
  printWindow.document.close();

  printWindow.onload = () => {
    printWindow.print();
    printWindow.close();
    printOutlet.innerHTML = ""; // Clear the hidden print area after print
  };
}

printTeacherListButton.addEventListener("click", printTeacherListReport);

// Manual Review Module - extends the original Emailer tool
(function() {
  'use strict';

  const manualChecklistItems = [
    { id: 'power-trust', label: 'Power of Trust statement present', category: 'Brand' },
    { id: 'title-case', label: 'Headers in Title Case', category: 'Typography' },
    { id: 'preheader-period', label: 'Pre-header ends with period', category: 'Typography' },
    { id: 'card-name-single', label: 'Card name on single line (not split)', category: 'Card Names' },
    { id: 'trademark', label: 'Registered trademark ® symbol used', category: 'Brand' },
    { id: 'amex-not-split', label: 'American Express® not split', category: 'Brand' },
    { id: 'asterisks-numbers', label: 'Asterisks on all numbers with footnotes', category: 'Special Characters' },
    { id: 'asterisks-not-linked', label: 'Asterisks NOT hyperlinked', category: 'Special Characters' },
    { id: 'click-here', label: 'Click "here" text is hyperlinked', category: 'Hyperlinks' },
    { id: 'footer-address', label: 'Footer address in correct format (DLF City)', category: 'Footer' },
    { id: 'copyright', label: 'Copyright notice included', category: 'Footer' },
    { id: 'card-member', label: 'Card Member written as two words', category: 'Typography' },
    { id: 'card-membership', label: 'Card Membership written as two words', category: 'Typography' },
    { id: 'signature', label: 'Card signature/footer correct (SK or AEBC)', category: 'Footer' },
    { id: 'no-grey', label: 'No excessive grey coloring used', category: 'Design' },
    { id: 'icons-not-boxes', label: 'Icons used instead of boxes', category: 'Design' },
    { id: 'indian-imagery', label: 'Indian imagery used', category: 'Images' },
    { id: 'superscripts', label: 'Superscripts match body copy', category: 'Special Characters' },
    { id: 'tcs-uppercase', label: 'T&Cs Apply - T, C & A in uppercase', category: 'Typography' },
    { id: 'cta-button', label: 'CTA button present and appropriate', category: 'CTAs' },
    { id: 'no-unsubscribe', label: 'No Unsubscribe in servicing mailers', category: 'Footer' },
    { id: 'uk-english', label: 'UK English spelling used', category: 'Content' },
    { id: 'no-spelling', label: 'Body copy free of spelling errors', category: 'Content' },
    { id: 'benefits-prominent', label: 'Benefits highlighted prominently', category: 'Content' },
    { id: 'line-breaks', label: 'Line breaks make sense (no awkward cuts)', category: 'Layout' },
    { id: 'mobile-responsive', label: 'Mailer mobile responsive', category: 'Mobile' }
  ];

  const ManualReviewStorage = {
    KEY: 'emailer_manual_reviews',

    getReviews() {
      const data = localStorage.getItem(this.KEY);
      return data ? JSON.parse(data) : {};
    },

    saveReview(mailerName, review) {
      const reviews = this.getReviews();
      reviews[mailerName] = {
        ...review,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem(this.KEY, JSON.stringify(reviews));
    },

    getReview(mailerName) {
      const reviews = this.getReviews();
      return reviews[mailerName];
    }
  };

  // Add manual review HTML to the report
  function addManualReviewSection() {
    const reportEl = document.getElementById('report');

    // Create manual review section HTML
    const manualReviewHTML = document.createElement('div');
    manualReviewHTML.className = 'manual-review-section';
    manualReviewHTML.innerHTML = `
      <div style="background: white; padding: 30px; border-radius: 8px; margin-top: 30px; border-left: 4px solid #003f87;">
        <h2 style="color: #003f87; margin-bottom: 20px; font-size: 22px;">Manual Compliance Review</h2>

        <div id="reviewMessage" style="margin-bottom: 20px;"></div>

        <div style="background: #f0f5ff; padding: 20px; border-radius: 4px; margin-bottom: 20px; border: 1px solid #ddd;">
          <h3 style="color: #003f87; font-size: 14px; margin-bottom: 15px; font-weight: 700;">Reviewer Information</h3>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
            <div>
              <label style="display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #333;">Checker Name <span style="color: #dc3545;">*</span></label>
              <input type="text" id="checkerName" placeholder="Your name" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;">
            </div>
            <div>
              <label style="display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #333;">Check Date</label>
              <input type="text" id="checkDate" readonly style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #f5f5f5;">
            </div>
          </div>
        </div>

        <h3 style="color: #003f87; font-size: 14px; margin-bottom: 15px; font-weight: 700;">Design Guidelines Checklist</h3>
        <p style="margin-bottom: 15px; font-size: 12px; color: #666;">Check off each item as you verify compliance:</p>

        <div id="manualChecklistItems" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
          <!-- Checklist items will be generated here -->
        </div>

        <div style="background: white; padding: 15px; border-radius: 4px; margin-top: 15px; border: 1px solid #ddd;">
          <label style="display: block; font-weight: 600; margin-bottom: 10px; color: #003f87; font-size: 13px;">Additional Notes</label>
          <textarea id="manualNotes" placeholder="Add any additional findings, issues, or recommendations..." style="width: 100%; min-height: 120px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; font-family: 'Courier New', monospace; resize: vertical;"></textarea>
        </div>

        <div style="display: flex; gap: 10px; margin-top: 20px;">
          <button id="submitManualReviewBtn" style="padding: 12px 20px; background: #003f87; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 13px; transition: all 0.3s ease;">Submit Manual Review</button>
          <button id="resetManualReviewBtn" style="padding: 12px 20px; background: #f0f0f0; color: #333; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 13px; transition: all 0.3s ease;">Reset Form</button>
        </div>

        <div id="submitMessage" style="margin-top: 15px;"></div>
      </div>
    `;

    // Append to report
    if (reportEl && !reportEl.hidden) {
      reportEl.appendChild(manualReviewHTML);
      initializeManualReview();
    }
  }

  // Initialize manual review
  function initializeManualReview() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('checkDate').value = today;

    renderManualChecklist();

    // Get mailer name from session/report
    const mailerName = window.currentMailerName || 'mailer.pdf';
    checkExistingReview(mailerName);

    // Add event listeners
    document.getElementById('submitManualReviewBtn').addEventListener('click', () => {
      submitManualReview(mailerName);
    });

    document.getElementById('resetManualReviewBtn').addEventListener('click', resetManualReviewForm);
  }

  // Render checklist
  function renderManualChecklist() {
    const html = manualChecklistItems.map(item => `
      <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: white; border-radius: 4px; border: 1px solid #ddd;">
        <input type="checkbox" id="check-${item.id}" value="${item.id}" style="margin-top: 4px; cursor: pointer; width: 18px; height: 18px;">
        <label for="check-${item.id}" style="cursor: pointer; font-size: 13px; color: #333; flex: 1; margin: 0;">
          <div>${item.label}</div>
          <div style="font-size: 11px; color: #999; margin-top: 3px;">${item.category}</div>
        </label>
      </div>
    `).join('');

    document.getElementById('manualChecklistItems').innerHTML = html;
  }

  // Get checked items
  function getCheckedItems() {
    const checkboxes = document.querySelectorAll('#manualChecklistItems input[type="checkbox"]:checked');
    const checked = Array.from(checkboxes).map(cb => {
      const item = manualChecklistItems.find(i => i.id === cb.value);
      return item ? item.label : cb.value;
    });
    return checked;
  }

  // Submit review
  function submitManualReview(mailerName) {
    const checkerName = document.getElementById('checkerName').value.trim();
    const checkedItems = getCheckedItems();
    const notes = document.getElementById('manualNotes').value.trim();

    if (!checkerName) {
      showMessage('error', '✗ Please enter your name as the reviewer');
      return;
    }

    if (checkedItems.length === 0) {
      showMessage('error', '✗ Please check at least one item');
      return;
    }

    const review = {
      checkerName: checkerName,
      checkDate: document.getElementById('checkDate').value,
      checkedItems: checkedItems,
      totalItemsChecked: checkedItems.length,
      totalItems: manualChecklistItems.length,
      notes: notes,
      mailerName: mailerName
    };

    ManualReviewStorage.saveReview(mailerName, review);
    showMessage('success', `✓ Manual review submitted by ${checkerName}! Checked ${checkedItems.length}/${manualChecklistItems.length} items.`);

    setTimeout(() => {
      resetManualReviewForm();
    }, 2000);
  }

  // Reset form
  function resetManualReviewForm() {
    document.querySelectorAll('#manualChecklistItems input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.getElementById('manualNotes').value = '';
    document.getElementById('submitMessage').innerHTML = '';
  }

  // Show message
  function showMessage(type, text) {
    const messageEl = document.getElementById('submitMessage');
    const className = type === 'success' ? 'success-msg' : 'error-msg';
    const style = type === 'success'
      ? 'background: #d4edda; color: #155724; padding: 12px; border-radius: 4px; border: 1px solid #c3e6cb;'
      : 'background: #f8d7da; color: #721c24; padding: 12px; border-radius: 4px; border: 1px solid #f5c6cb;';
    messageEl.innerHTML = `<div style="${style}">${text}</div>`;
  }

  // Check existing review
  function checkExistingReview(mailerName) {
    const existingReview = ManualReviewStorage.getReview(mailerName);
    if (existingReview) {
      const msg = `
        <div style="background: #d4edda; color: #155724; padding: 12px; border-radius: 4px; border: 1px solid #c3e6cb; margin-bottom: 20px;">
          <strong>✓ This mailer was already reviewed</strong><br>
          Reviewer: <strong>${existingReview.checkerName}</strong> · Date: ${new Date(existingReview.timestamp).toLocaleDateString()}<br>
          Items Checked: ${existingReview.totalItemsChecked}/${existingReview.totalItems}<br>
          <em style="display: block; margin-top: 8px;">You can submit a new review if needed.</em>
        </div>
      `;
      document.getElementById('reviewMessage').innerHTML = msg;
    }
  }

  // Hook into original app.js to add manual review when report is shown
  const originalFetch = window.fetch;
  window.addEventListener('load', () => {
    // Watch for report display changes
    const reportEl = document.getElementById('report');
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'hidden' && !reportEl.hidden && reportEl.children.length > 0) {
          // Check if manual review section already added
          if (!document.querySelector('.manual-review-section')) {
            setTimeout(() => {
              addManualReviewSection();
            }, 500);
          }
        }
      });
    });

    if (reportEl) {
      observer.observe(reportEl, { attributes: true });

      // Also check immediately in case report is already visible
      setTimeout(() => {
        if (!reportEl.hidden && reportEl.children.length > 0 && !document.querySelector('.manual-review-section')) {
          addManualReviewSection();
        }
      }, 1000);
    }
  });

  // Store mailer name from file input
  const fileInput = document.getElementById('file');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) {
        window.currentMailerName = e.target.files[0].name;
      }
    });
  }
})();

async function scrapeGmapsDeepData() {
  // Grab EVERY single link on the page, no matter where it is located
  const allLinks = Array.from(document.querySelectorAll("a"));
  const validListings = [];
  const seenUrls = new Set();

  allLinks.forEach((link) => {
    const href = link.href || "";
    // If it's a valid place link and we haven't processed it yet
    if (href.includes("/maps/place/") && !seenUrls.has(href)) {
      seenUrls.add(href);
      validListings.push(link);
    }
  });

  const data = [];
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Loop through the items up to a maximum of 30
  for (let titleEl of validListings) {
    if (data.length >= 30) break;

    try {
      // 1. Click the listing link to open the side panel details
      titleEl.click();
      await delay(2500); // Wait for the information to load completely

      // 2. Extract name using your custom exact class fallback
      let nameEl = document.querySelector("h1.DUwDvf");
      let name = nameEl ? nameEl.innerText : "";

      if (!name) {
        name =
          titleEl.getAttribute("aria-label") || titleEl.innerText || "Unknown";
      }
      name = name
        .replace(/·\s*Visited\s*link/gi, "")
        .replace(/[\n\r]+/g, " ")
        .trim();
      if (name === "Unknown" || name.length === 0) continue;

      // 3. Extract rating and reviews using your custom layout
      let rating = "N/A";
      let reviewCount = "N/A";
      const reviewContainer = document.querySelector(".F7nice");
      if (reviewContainer) {
        const ratingEl = reviewContainer.querySelector(
          'span[aria-hidden="true"]',
        );
        const countEl = reviewContainer.querySelector(
          'span[aria-label*="reviews"]',
        );
        if (ratingEl) rating = ratingEl.innerText;
        if (countEl)
          reviewCount = countEl.getAttribute("aria-label").replace(/[()]/g, "");
      }

      // 4. Extract Address, Website and Phone Number
      let locationText = "N/A";
      let websiteUrl = "N/A";
      let phoneNumber = "N/A";

      // Scan all text layouts matching your custom pattern (.AeaXub)
      const rows = document.querySelectorAll(".AeaXub");
      rows.forEach((row) => {
        const textEl = row.querySelector(".Io6YTe");
        if (textEl) {
          const innerText = textEl.innerText || "";
          const htmlContext = row.innerHTML;

          if (
            htmlContext.includes("") ||
            innerText.includes(".com") ||
            innerText.includes(".org") ||
            innerText.includes(".net")
          ) {
            const nestedLink = row.querySelector("a");
            websiteUrl = nestedLink ? nestedLink.href : `https://${innerText}`;
          } else if (
            htmlContext.includes("") ||
            /\b[A-Z]{2}\s\d{5}\b/i.test(innerText)
          ) {
            locationText = innerText;
          }
        }
      });

      // Fallback search for Phone number if rows don't yield it
      const phoneButton = document.querySelector(
        'button[data-item-id^="phone:tel:"], a[href^="tel:"]',
      );
      if (phoneButton) {
        const rawPhone =
          phoneButton.getAttribute("data-item-id") ||
          phoneButton.getAttribute("href");
        phoneNumber = rawPhone
          .replace("phone:tel:", "")
          .replace("tel:", "")
          .trim();
      } else {
        const bodyText = document.body.innerText || "";
        const phoneMatch = bodyText.match(
          /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/,
        );
        if (phoneMatch) phoneNumber = phoneMatch[0];
      }

      data.push({
        name,
        rating,
        reviewCount,
        hasWebsite: websiteUrl !== "N/A" ? "Yes" : "No",
        websiteUrl,
        locationText,
        phoneNumber,
        mapsUrl: titleEl.href,
      });
    } catch (err) {
      console.error("Failed item extraction row:", err);
    }
  }

  return data;
}

function downloadCSV(data) {
  let csv =
    "\uFEFFName,Rating,Review Count,Has Website,Website URL,Location Address,Phone Number,Google Maps URL\n";
  data.forEach((row) => {
    csv += `"${row.name.replace(/"/g, '""')}",`;
    csv += `"${row.rating}",`;
    csv += `"${row.reviewCount}",`;
    csv += `"${row.hasWebsite}",`;
    csv += `"${row.websiteUrl}",`;
    csv += `"${row.locationText.replace(/"/g, '""')}",`;
    csv += `"${row.phoneNumber}",`;
    csv += `"${row.mapsUrl}"\n`;
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", "gmaps_final_leads.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

document.getElementById("scrapeBtn").addEventListener("click", async () => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  const statusEl = document.getElementById("status");
  statusEl.className = "status-box loading";
  statusEl.innerHTML =
    '<span class="spinner-dots"><span></span><span></span><span></span></span> Scanning all links on page...';

  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      func: scrapeGmapsDeepData,
    },
    (results) => {
      if (chrome.runtime.lastError) {
        statusEl.className = "status-box error";
        statusEl.innerText = "Please refresh the page and try again.";
        return;
      }

      if (results && results[0] && results[0].result) {
        const data = results[0].result;
        if (data.length === 0) {
          statusEl.className = "status-box error";
          statusEl.innerText =
            "No map profiles visible. Please scroll your list down first.";
        } else {
          downloadCSV(data);
          statusEl.className = "status-box success";
          statusEl.innerText = `Success! Grabbed ${data.length} profiles.`;
        }
      } else {
        statusEl.className = "status-box error";
        statusEl.innerText = "Extraction dropped.";
      }
    },
  );
});

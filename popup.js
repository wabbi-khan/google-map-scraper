async function scrapeGmapsDeepData(maxResults) {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const data = [];

  try {
    const scrollContainer =
      document.querySelector('div[role="feed"]') ||
      document.querySelector('.m6QErb[aria-label*="Results"]') ||
      document.querySelector('.m6QErb[aria-label*="resultats"]') ||
      document.querySelector('.m6QErb[aria-label*="résultats"]') ||
      document.querySelector('div[role="main"]') ||
      document.querySelector(".m6QErb");

    const processed = new Set();

    const getUnprocessedLinks = () => {
      return Array.from(document.querySelectorAll("a"))
        .filter((l) => l.href && l.href.includes("/maps/place/"))
        .filter((l) => !processed.has(l.href));
    };

    const scrollForMore = async () => {
      if (!scrollContainer) return false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const before = getUnprocessedLinks().length;
        scrollContainer.scrollBy(0, 1000);
        await delay(2000);
        const after = getUnprocessedLinks().length;
        if (after > before) return true;
      }
      return false;
    };

    while (data.length < maxResults) {
      let candidates = getUnprocessedLinks();
      if (candidates.length === 0) {
        const loaded = await scrollForMore();
        if (!loaded) break;
        continue;
      }

      const titleEl = candidates[0];
      processed.add(titleEl.href);

      try {
        titleEl.click();
        await delay(2500);

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

        let locationText = "N/A";
        let websiteUrl = "N/A";
        let phoneNumber = "N/A";

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
  } catch (e) {
    console.error("scrapeGmapsDeepData error:", e);
    return data || [];
  }
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
    '<span class="spinner-dots"><span></span><span></span><span></span></span> Scrolling & loading all results...';

  const maxResults =
    parseInt(document.getElementById("maxResults").value, 10) || 30;

  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      func: scrapeGmapsDeepData,
      args: [maxResults],
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

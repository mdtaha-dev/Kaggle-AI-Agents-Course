import os
import requests
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
from flask import Flask, jsonify, render_template

app = Flask(__name__)

FEED_URL = "https://docs.cloud.google.com/feeds/bigquery-release-notes.xml"
NAMESPACE = {"atom": "http://www.w3.org/2005/Atom"}

def parse_release_notes():
    try:
        response = requests.get(FEED_URL, timeout=15)
        response.raise_for_status()
    except Exception as e:
        return {"error": f"Failed to fetch release notes: {str(e)}"}

    try:
        root = ET.fromstring(response.content)
    except Exception as e:
        return {"error": f"Failed to parse XML: {str(e)}"}

    updates = []
    
    # Each entry contains release notes for a specific day
    for entry in root.findall("atom:entry", NAMESPACE):
        title_el = entry.find("atom:title", NAMESPACE)
        date_str = title_el.text if title_el is not None else "Unknown Date"
        
        id_el = entry.find("atom:id", NAMESPACE)
        entry_id = id_el.text if id_el is not None else ""
        
        updated_el = entry.find("atom:updated", NAMESPACE)
        updated_str = updated_el.text if updated_el is not None else ""
        
        link_el = entry.find("atom:link", NAMESPACE)
        link_url = link_el.attrib.get("href", "") if link_el is not None else ""
        
        content_el = entry.find("atom:content", NAMESPACE)
        if content_el is None or not content_el.text:
            continue
            
        # Parse HTML content inside entry
        soup = BeautifulSoup(content_el.text, "html.parser")
        
        # Google release notes structure: <h3>[Type]</h3> followed by <p> or <ul> elements
        current_type = "General"
        current_content_parts = []
        update_index = 0
        
        # Iterate through child elements to group content by <h3> headers
        for child in soup.children:
            if child.name == "h3":
                # Save previous update if exists
                if current_content_parts:
                    updates.append({
                        "id": f"{entry_id}_{update_index}",
                        "date": date_str,
                        "updated": updated_str,
                        "type": current_type,
                        "content": "".join(current_content_parts),
                        "text_content": BeautifulSoup("".join(current_content_parts), "html.parser").get_text(separator=" ").strip(),
                        "link": link_url
                    })
                    update_index += 1
                    current_content_parts = []
                current_type = child.get_text().strip()
            elif child.name:
                current_content_parts.append(str(child))
                
        # Append the last update
        if current_content_parts or current_type != "General":
            updates.append({
                "id": f"{entry_id}_{update_index}",
                "date": date_str,
                "updated": updated_str,
                "type": current_type,
                "content": "".join(current_content_parts),
                "text_content": BeautifulSoup("".join(current_content_parts), "html.parser").get_text(separator=" ").strip(),
                "link": link_url
            })

    return {"updates": updates}

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/notes")
def get_notes():
    data = parse_release_notes()
    return jsonify(data)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

# Eis Granola Sync for Obsidian

An Obsidian plugin that automatically syncs your [Granola AI](https://granola.ai) meeting notes to your Obsidian vault with full customization options and real-time status updates.

> This plugin is a modified version of the original plugin [Granola-to-Obsidian](https://github.com/dannymcc/Granola-to-Obsidian) by [Danny McClelland](https://github.com/dannymcc).

![Granola Sync](https://i.imgur.com/Ztm8J9m.png)

## 🚀 Original Features

- **🔄 Automatic Sync**: Configurable auto-sync from every minute to daily, or manual-only
- **📊 Status Bar Integration**: Real-time sync status in the bottom right corner (no more popup spam!)
- **📅 Custom Date Formats**: Support for multiple date formats (YYYY-MM-DD, DD-MM-YYYY, etc.)
- **📝 Flexible Filename Templates**: Customize how notes are named with variables like date, time, and title
- **📁 Custom Directory**: Choose where in your vault to sync notes
- **🏷️ Note Prefixes**: Add custom prefixes to all synced notes
- **🔧 Custom Auth Path**: Override the default Granola credentials location
- **🗓️ Daily Note Integration**: Automatically add today's meetings to your Daily Note with times and links
- **📅 Periodic Notes Support**: Full integration with the Periodic Notes plugin for flexible daily note management
- **🏷️ Attendee Tagging**: Automatically extract meeting attendees and add them as organized tags (e.g., `person/john-smith`)
- **🔗 Granola URL Links**: Add direct links back to original Granola notes in frontmatter for easy access
- **🔧 Smart Filtering**: Exclude your own name from attendee tags with configurable settings
- **🛡️ Preserve Manual Additions**: Option to skip updating existing notes, preserving your tags, summaries, and custom properties
- **✨ Rich Metadata**: Includes frontmatter with creation/update dates and Granola IDs
- **📋 Content Conversion**: Converts ProseMirror content to clean Markdown
- **🔄 Update Handling**: Intelligently updates existing notes instead of creating duplicates

### In this fork:
- **📋 Default Properties**: Add default properties and values in note frontmatter
- **✨ Default tags**: Add default tags to notes when sync
- **Names equal to original note title**: Maintain the name of imported note equal to original granola note title (original plugin replaces title spaces with "_").


## 📦 Installation

### Manual Installation

1. Download the latest release from the [Releases page](https://github.com/dies/Eis-Granola-to-Obsidian/releases)
2. Extract the files to your vault's plugins directory: `.obsidian/plugins/granola-sync/`
3. Enable the plugin in Obsidian Settings → Community Plugins
4. Configure your sync settings

### Files to Download
- `main.js`
- `manifest.json` 
- `styles.css`
- `versions.json`

## ⚙️ Configuration

Access plugin settings via **Settings → Community Plugins → Granola Sync**

### Sync Directory
Choose which folder in your vault to sync notes to (default: `Granola`)

### Note Prefix
Optional prefix to add to all synced note filenames (e.g., `meeting-`, `granola-`)

### Auth Key Path
Path to your Granola authentication file. Default locations:
- **macOS**: `Users/USERNAME/Library/Application Support/Granola/supabase.json`
- **Windows**: `AppData/Roaming/Granola/supabase.json`

The plugin automatically detects your operating system and sets the appropriate default path.

### Filename Template
Customize how your notes are named using these variables:
- `{title}` - The meeting/note title
- `{id}` - Granola document ID
- `{created_date}` - Creation date
- `{updated_date}` - Last updated date  
- `{created_time}` - Creation time
- `{updated_time}` - Last updated time
- `{created_datetime}` - Full creation date and time
- `{updated_datetime}` - Full updated date and time

**Example Templates:**
- `{created_date}_{title}` → `2025-06-06_Team_Standup_Meeting.md`
- `Meeting_{created_datetime}_{title}` → `Meeting_2025-06-06_14-30-00_Team_Standup_Meeting.md`

### Date Format
Customize date formatting using these tokens:
- `YYYY` - 4-digit year (2025)
- `YY` - 2-digit year (25)
- `MM` - 2-digit month (06)
- `DD` - 2-digit day (06)
- `HH` - 2-digit hours (14)
- `mm` - 2-digit minutes (30)
- `ss` - 2-digit seconds (45)

**Popular Formats:**
- `YYYY-MM-DD` → 2025-06-06 (ISO)
- `DD-MM-YYYY` → 06-06-2025 (European)
- `MM-DD-YYYY` → 06-06-2025 (US)
- `DD.MM.YY` → 06.06.25 (German)

### Attendee Tagging

Automatically extract meeting attendees from Granola and add them as organized tags in your note frontmatter.

#### Settings:
- **Include Attendee Tags**: Enable/disable attendee tagging (disabled by default)
- **Exclude My Name from Tags**: Remove your own name from attendee tags (recommended)
- **My Name**: Set your name as it appears in Granola meetings for filtering
- **Attendee Tag Template**: Customize the tag structure using `{name}` placeholder

#### Tag Format & Customization:
- **Default format**: `person/{name}` (e.g., "John Smith" → `person/john-smith`)
- **Customizable structure**: Use the template setting to organize tags your way
- **Template examples**:
  - `people/{name}` → `people/john-smith` (group under "people")
  - `meeting-attendees/{name}` → `meeting-attendees/john-smith` (descriptive grouping)
  - `attendees/{name}` → `attendees/john-smith` (simple grouping)
  - `contacts/work/{name}` → `contacts/work/john-smith` (multi-level hierarchy)
- **Name processing**: Special characters removed, spaces become hyphens, all lowercase

#### Benefits:
- **Easy searching**: Find all meetings with specific people using `#person/john-smith`
- **Clean organization**: All attendee tags grouped under `person/` prefix
- **Smart filtering**: Your name is automatically excluded from tags
- **Retroactive updates**: Can update existing notes with attendee tags while preserving content

### Granola URL Integration

Add direct links back to your original Granola notes for seamless workflow integration.

#### Setting:
- **Include Granola URL**: Enable/disable URL links in frontmatter (disabled by default)

#### How it works:
When enabled, each synced note includes a `granola_url` field in the frontmatter that links directly to the original note in the Granola web app:

```yaml
granola_url: "https://notes.granola.ai/d/abc123def456"
```

#### Benefits:
- **Quick access**: One-click to open the original note in Granola
- **Cross-platform**: Works with both desktop and web versions of Granola
- **Always current**: URL automatically generated from document ID
- **Non-intrusive**: Appears cleanly in frontmatter without cluttering note content

### Auto-Sync Frequency
Choose how often to automatically sync:
- Never (manual only)
- Every 1-2 minutes (frequent)
- Every 5-15 minutes (recommended)
- Every 30 minutes to 24 hours (conservative)

## 🎯 Usage

### Manual Sync
- Click the sync icon in the ribbon (left sidebar)
- Use Command Palette: "Sync Granola Notes"
- Click "Sync Now" in plugin settings
- **Watch the status bar** (bottom right) for real-time progress

### Auto-Sync
Set your preferred frequency in settings and the plugin will sync automatically in the background. Status updates appear in the status bar.

### Status Bar Indicators
- **"Granola Sync: Idle"** - Ready to sync
- **"Granola Sync: Syncing..."** - Currently syncing (with animation)
- **"Granola Sync: X notes synced"** - Success (shows for 3 seconds)
- **"Granola Sync: Error - [details]"** - Error occurred (shows for 5 seconds)

### Skip Existing Notes
When enabled, notes that already exist in your vault will not be updated during sync. This is perfect for preserving any manual additions you've made such as:
- Custom tags
- Personal summaries
- Additional notes or comments
- Custom frontmatter properties

**How it works**: The plugin uses the `granola_id` in the frontmatter to identify existing notes, so you can safely:
- Rename note files
- Change filename templates
- Modify note titles
- Move notes within the sync directory

As long as you don't modify the `granola_id` field, the plugin will recognize them as the same note.

**Note**: New notes from Granola will still be imported, but existing ones won't be overwritten.

### 🧪 Experimental: Search Scope for Existing Notes

**⚠️ Please backup your vault before using this feature!**

This experimental feature allows you to control where the plugin searches for existing notes when checking for duplicates by `granola_id`.

#### Search Scope Options:
- **Sync Directory Only (Default)**: Only searches within your configured sync directory
- **Entire Vault**: Searches all markdown files in your vault (allows you to move notes anywhere)
- **Specific Folders**: Search only in folders you specify

#### Why Use This Feature:
- **Organize freely**: Move your Granola notes to different folders without creating duplicates
- **Flexible workflows**: Keep meeting notes in project folders, daily folders, or anywhere you prefer
- **Avoid duplicates**: Plugin finds existing notes regardless of their location

#### How to Use Safely:
1. **Backup your vault first!**
2. **Test with manual sync**: Change settings, then run manual sync to test
3. **Use the tools**: 
   - "Find Duplicate Notes" - scan for existing duplicates
   - "Re-enable Auto-Sync" - restart auto-sync after testing
4. **Consider "Entire Vault"**: Safest option if you want to move notes around

#### Example Workflow:
```
1. You have notes in "Granola/" folder
2. You want to organize them by project: "Projects/ProjectA/", "Projects/ProjectB/"
3. Set search scope to "Entire Vault"
4. Move your existing notes to project folders
5. Run manual sync to test - no duplicates created!
6. Re-enable auto-sync
```

#### Avoiding Duplicates:
- **Before changing settings**: Move notes to new location OR use "Entire Vault" search
- **After changing settings**: Run manual sync first, then re-enable auto-sync
- **If you get duplicates**: Use "Find Duplicate Notes" tool to identify and clean them up

#### Settings Location:
Under **🧪 Experimental Features** section in plugin settings.

### Daily Note Integration
When enabled, today's Granola meetings automatically appear in your Daily Note:

```markdown
## Granola Meetings
- 09:30 [[Granola/2025-06-09_Team_Standup|Team Standup]]
- 14:00 [[Granola/2025-06-09_Client_Review|Client Review Meeting]]
```

### Periodic Notes Integration
The plugin now supports the [Periodic Notes plugin](https://github.com/liamcain/obsidian-periodic-notes) for enhanced daily note management:

- **Independent Integration**: Works alongside or instead of Daily Notes integration
- **Plugin Detection**: Automatically detects if Periodic Notes plugin is available
- **Flexible Configuration**: Separate section heading configuration for Periodic Notes
- **Seamless Workflow**: Integrates with Periodic Notes' daily note creation and templating

**Setup Requirements:**
1. Install and enable the [Periodic Notes plugin](https://github.com/liamcain/obsidian-periodic-notes)
2. Configure your daily note templates in Periodic Notes settings
3. Enable "Periodic note integration" in Granola Sync settings
4. Customize the section heading as desired

### Attendee Tagging Usage

Once enabled, attendee tagging automatically enhances your meeting notes:

#### Finding Meetings by Attendee
- **Search by tag**: Use `#person/john-smith` to find all meetings with John Smith
- **Tag panel**: Browse all `person/` tags in Obsidian's tag panel
- **Graph view**: Visualize meeting connections through attendee relationships

#### Smart Name Detection
The plugin extracts attendee names from:
- Granola's `people` field (primary source)
- Google Calendar attendee information (if available)
- Email addresses (converts to readable names when needed)

#### Automatic Updates
When both "Skip Existing Notes" and "Include Attendee Tags" are enabled:
- **Content preserved**: Your manual edits, summaries, and custom properties remain untouched
- **Tags updated**: Attendee tags are refreshed based on current meeting data
- **Non-person tags preserved**: Your custom tags are kept alongside attendee tags

**Example workflow:**
1. Enable attendee tagging in settings
2. Set your name (e.g., "Danny McClelland") to exclude from tags
3. Run sync - existing notes get attendee tags, content stays the same
4. Future syncs keep attendee tags current while preserving your edits

### Preview Your Settings
Use the preview buttons in settings to see how your filename template and date format will look before syncing.

## 📄 Note Format

Synced notes include rich frontmatter with metadata:

```markdown
---
granola_id: abc123def456
title: "Team Standup Meeting"
granola_url: "https://notes.granola.ai/d/abc123def456"
created_at: 2025-06-06T14:30:00.000Z
updated_at: 2025-06-06T15:45:00.000Z
tags:
  - people/john-smith
  - people/sarah-jones
  - people/mike-wilson
---

# Team Standup Meeting

Your converted meeting content appears here in clean Markdown format.

- Action items are preserved
- Headings maintain their structure
- All formatting is converted appropriately
```

## 🔧 Requirements

- Obsidian v0.15.0+
- Active Granola AI account
- Granola desktop app installed and authenticated (available for macOS and Windows)

## 🐛 Troubleshooting

### Plugin Won't Enable
- Check that all plugin files are in the correct directory
- Ensure you have the latest version of Obsidian
- Check the console (Ctrl/Cmd + Shift + I) for error messages

### No Notes Syncing
- Verify your Granola auth key path is correct
- Check that you have meeting notes in your Granola account
- Ensure the sync directory exists or can be created
- Look for error messages in the Obsidian console

### Authentication Issues
- Make sure Granola desktop app is logged in
- Check that the auth key file exists at the expected location:
  - **macOS**: `~/Library/Application Support/Granola/supabase.json`
  - **Windows**: `C:\Users\[USERNAME]\AppData\Roaming\Granola\supabase.json`
- If the file is in a different location, update the "Auth Key Path" in plugin settings
- Try logging out and back in to Granola

### File Naming Issues
- Use the preview buttons to test your templates
- Avoid special characters in custom prefixes
- Check that your date format is valid

### Attendee Tagging Issues
- **No attendee tags appearing**: Check that "Include Attendee Tags" is enabled in settings
- **Your name still appears in tags**: Update "My Name" setting to match exactly how it appears in Granola
- **Missing attendees**: Some meeting platforms may not provide complete attendee information
- **Duplicate tags**: The plugin automatically prevents duplicate tags - check for variations in name formatting
- **Tags not updating**: Ensure both "Skip Existing Notes" and "Include Attendee Tags" are enabled for updates

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup
1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run build` to compile
4. Copy files to your Obsidian plugins directory for testing

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- With thanks to [Joseph Thacker](https://josephthacker.com/) for first discovering that it's possible to query the Granola [API using locally stored auth keys](https://josephthacker.com/hacking/2025/05/08/reverse-engineering-granola-notes.html)!
- [Granola AI](https://granola.ai) for creating an amazing meeting assistant
- The Obsidian community for plugin development resources
- Contributors and testers who helped improve this plugin

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/dannymcc/Granola-to-Obsidian/issues)
- **Documentation**: This README and plugin settings descriptions
- **Community**: [Obsidian Discord](https://discord.gg/veuWUTm) #plugin-dev channel

---

**Made with ❤️ by [Danny McClelland](https://github.com/dannymcc)**
**Modified by [Diego Eis](https://github.com/diegoeis/)**

*Not officially affiliated with Granola AI or Obsidian.*

const obsidian = require('obsidian');
const path = require('path');
const fs = require('fs');

function getDefaultAuthPath() {
	if (obsidian.Platform.isWin) {
		return 'AppData/Roaming/Granola/supabase.json';
	} else if (obsidian.Platform.isLinux) {
		return '.config/Granola/supabase.json';
	} else {
		// Default to macOS path
		return 'Library/Application Support/Granola/supabase.json';
	}
}

const DEFAULT_SETTINGS = {
	syncDirectory: 'Granola',
	notePrefix: '',
	authKeyPath: getDefaultAuthPath(),
	filenameTemplate: '{title}',
	dateFormat: 'YYYY-MM-DD',
	autoSyncFrequency: 300000,
	enableDailyNoteIntegration: false,
	dailyNoteSectionName: '## Granola Meetings',
	enablePeriodicNoteIntegration: false,
	periodicNoteSectionName: '## Granola Meetings',
	skipExistingNotes: false,
	includeAttendeeTags: false,
	excludeMyNameFromTags: true,
	myName: 'Diego Eis',
	includeFolderTags: false,
	includeGranolaUrl: false,
	attendeeTagTemplate: 'person/{name}',
	existingNoteSearchScope: 'syncDirectory', // 'syncDirectory', 'entireVault', 'specificFolders'
	specificSearchFolders: [], // Array of folder paths to search in when existingNoteSearchScope is 'specificFolders'
	enableDateBasedFolders: false,
	dateFolderFormat: 'YYYY-MM-DD',
	defaultTags: [], // Array of default tags to add to all notes
	customProperties: {}, // Object with custom properties to add to frontmatter (key: value pairs)
};

class GranolaSyncPlugin extends obsidian.Plugin {
	async onload() {
		this.autoSyncInterval = null;
		this.settings = DEFAULT_SETTINGS;
		this.statusBarItem = null;
		this.ribbonIconEl = null;
		
		try {
			const data = await this.loadData();
			if (data) {
				this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
			}
		} catch (error) {
			// Could not load settings, using defaults
		}

		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar('Idle');

		// Add ribbon icon
		this.ribbonIconEl = this.addRibbonIcon('sync', 'Sync Granola notes', () => {
			this.syncNotes();
		});

		this.addCommand({
			id: 'sync-granola-notes',
			name: 'Sync Granola Notes',
			callback: () => {
				this.syncNotes();
			}
		});

		this.addSettingTab(new GranolaSyncSettingTab(this.app, this));

		window.setTimeout(() => {
			this.setupAutoSync();
		}, 1000);
	}

	onunload() {
		this.clearAutoSync();
	}

	async saveSettings() {
		try {
			await this.saveData(this.settings);
			this.setupAutoSync();
		} catch (error) {
			console.error('Failed to save settings:', error);
		}
	}

	async saveSettingsWithoutSync() {
		try {
			await this.saveData(this.settings);
		} catch (error) {
			console.error('Failed to save settings:', error);
		}
	}

	updateStatusBar(status, count) {
		if (!this.statusBarItem) return;
		
		let text = 'Granola Sync: ';
		
		if (status === 'Idle') {
			text += 'Idle';
		} else if (status === 'Syncing') {
			text += 'Syncing...';
		} else if (status === 'Complete') {
			text += count + ' notes synced';
			window.setTimeout(() => {
				this.updateStatusBar('Idle');
			}, 3000);
		} else if (status === 'Error') {
			text += 'Error - ' + (count || 'sync failed');
			window.setTimeout(() => {
				this.updateStatusBar('Idle');
			}, 5000);
		}
		
		this.statusBarItem.setText(text);
	}

	setupAutoSync() {
		this.clearAutoSync();
		
		if (this.settings.autoSyncFrequency > 0) {
			this.autoSyncInterval = window.setInterval(() => {
				this.syncNotes();
			}, this.settings.autoSyncFrequency);
		}
	}

	clearAutoSync() {
		if (this.autoSyncInterval) {
			window.clearInterval(this.autoSyncInterval);
			this.autoSyncInterval = null;
		}
	}

	getFrequencyLabel(frequency) {
		const minutes = frequency / (1000 * 60);
		const hours = frequency / (1000 * 60 * 60);
		
		if (frequency === 0) return 'Disabled';
		if (frequency < 60000) return (frequency / 1000) + ' seconds';
		if (minutes < 60) return minutes + ' minutes';
		return hours + ' hours';
	}

	// Helper function to get a readable speaker label
	getSpeakerLabel(source) {
		switch (source) {
			case "microphone":
				return "Me";
			case "system":
			default:
				return "Them";
		}
	}	

	// Helper function to format timestamp for display
	formatTimestamp(timestamp) {
		const d = new Date(timestamp);
		return [d.getHours(), d.getMinutes(), d.getSeconds()]
			.map(v => String(v).padStart(2, '0'))
			.join(':');
	}

	transcriptToMarkdown(segments) {
		if (!segments || segments.length === 0) {
			return "*No transcript content available*";
		}

		const sortedSegments = segments.slice().sort((a, b) => {
			const timeA = new Date(a.start_timestamp || 0);
			const timeB = new Date(b.start_timestamp || 0);
			return timeA - timeB;
		});

		const lines = [];
		let currentSpeaker = null;
		let currentText = "";
		let currentTimestamp = null;

		const flushCurrentSegment = () => {
			const cleanText = currentText.trim().replace(/\s+/g, " ");
			if (cleanText && currentSpeaker) {
				const timeStr = this.formatTimestamp(currentTimestamp);
				const speakerLabel = this.getSpeakerLabel(currentSpeaker);
				lines.push(`**${speakerLabel}** *(${timeStr})*: ${cleanText}`)
			}
			currentText = "";
			currentSpeaker = null;
			currentTimestamp = null;
		};

		for (const segment of sortedSegments) {
			if (currentSpeaker && currentSpeaker !== segment.source) {
				flushCurrentSegment();
			}
			if (!currentSpeaker) {
				currentSpeaker = segment.source;
				currentTimestamp = segment.start_timestamp;
			}
			const segmentText = segment.text;
			if (segmentText && segmentText.trim()) {
				currentText += currentText ? ` ${segmentText}` : segmentText;
			}
		}
		flushCurrentSegment();

		return lines.length === 0 ? "*No transcript content available*" : lines.join("\n\n");

	}

	async syncNotes() {
		try {
			this.updateStatusBar('Syncing');
			
			await this.ensureDirectoryExists();

			const token = await this.loadCredentials();
			if (!token) {
				this.updateStatusBar('Error', 'credentials failed');
				return;
			}

			const documents = await this.fetchGranolaDocuments(token);
			if (!documents) {
				this.updateStatusBar('Error', 'fetch failed');
				return;
			}

			let syncedCount = 0;
			const todaysNotes = [];
			const today = new Date().toDateString();

			for (let i = 0; i < documents.length; i++) {
				const doc = documents[i];
				try {
					// Fetch transcript if enabled
					if (this.settings.includeFullTranscript) {
						const transcriptData = await this.fetchTranscript(token, doc.id);
						doc.transcript = this.transcriptToMarkdown(transcriptData);
					}

					const success = await this.processDocument(doc);
					if (success) {
						syncedCount++;
					}
					
					// Check for daily note integration regardless of sync success
					// This ensures existing notes from today are still included
					if (this.settings.enableDailyNoteIntegration && doc.created_at) {
						const noteDate = new Date(doc.created_at).toDateString();
						if (noteDate === today) {
							// Find the actual file that was created or already exists
							const actualFile = await this.findExistingNoteByGranolaId(doc.id);
							
							if (actualFile) {
								const noteData = {};
								noteData.title = doc.title || 'Untitled Granola Note';
								noteData.actualFilePath = actualFile.path; // Use actual file path
								
								const createdDate = new Date(doc.created_at);
								const hours = String(createdDate.getHours()).padStart(2, '0');
								const minutes = String(createdDate.getMinutes()).padStart(2, '0');
								noteData.time = hours + ':' + minutes;
								
								todaysNotes.push(noteData);
							}
						}
					}
				} catch (error) {
					console.error('Error processing document ' + doc.title + ':', error);
				}
			}

			if (this.settings.enableDailyNoteIntegration && todaysNotes.length > 0) {
				await this.updateDailyNote(todaysNotes);
			}

			if (this.settings.enablePeriodicNoteIntegration && todaysNotes.length > 0) {
				await this.updatePeriodicNote(todaysNotes);
			}

			this.updateStatusBar('Complete', syncedCount);
			
		} catch (error) {
			console.error('Granola sync failed:', error);
			this.updateStatusBar('Error', 'sync failed');
		}
	}

	async loadCredentials() {
		const homedir = require('os').homedir();
		const authPaths = [
			// New location (with Users in path)
			path.resolve(homedir, 'Users', require('os').userInfo().username, 'Library/Application Support/Granola/supabase.json'),
			// Current configured path
			path.resolve(homedir, this.settings.authKeyPath),
			// Fallback to old default location
			path.resolve(homedir, 'Library/Application Support/Granola/supabase.json')
		];

		for (const authPath of authPaths) {
			try {
				if (!fs.existsSync(authPath)) {
					continue;
				}

				const credentialsFile = fs.readFileSync(authPath, 'utf8');
				const data = JSON.parse(credentialsFile);
				
				let accessToken = null;
				
				// Try new token structure (workos_tokens)
				if (data.workos_tokens) {
					try {
						const workosTokens = JSON.parse(data.workos_tokens);
						accessToken = workosTokens.access_token;
					} catch (e) {
						// workos_tokens might already be an object
						accessToken = data.workos_tokens.access_token;
					}
				}
				
				// Fallback to old token structure (cognito_tokens)
				if (!accessToken && data.cognito_tokens) {
					try {
						const cognitoTokens = JSON.parse(data.cognito_tokens);
						accessToken = cognitoTokens.access_token;
					} catch (e) {
						// cognito_tokens might already be an object
						accessToken = data.cognito_tokens.access_token;
					}
				}
				
				if (accessToken) {
					console.log('Successfully loaded credentials from:', authPath);
					return accessToken;
				}
			} catch (error) {
				console.error('Error reading credentials from', authPath, ':', error);
				continue;
			}
		}

		console.error('No valid credentials found in any of the expected locations');
		return null;
	}

	async fetchGranolaDocuments(token) {
		try {
			// Note: Workspace fetching is temporarily disabled as folder information is not available
			let workspaces = null;

			const response = await obsidian.requestUrl({
				url: 'https://api.granola.ai/v2/get-documents',
				method: 'POST',
				headers: {
					'Authorization': 'Bearer ' + token,
					'Content-Type': 'application/json',
					'Accept': '*/*',
					'User-Agent': 'Granola/5.354.0',
					'X-Client-Version': '5.354.0'
				},
				body: JSON.stringify({
					limit: 100,
					offset: 0,
					include_last_viewed_panel: true
				})
			});

			const apiResponse = response.json;
			
			if (!apiResponse || !apiResponse.docs) {
				console.error('API response format is unexpected');
				return null;
			}

			// Store workspaces for later use in folder extraction
			this.workspaces = workspaces;
			
			return apiResponse.docs;
		} catch (error) {
			console.error('Error fetching documents:', error);
			return null;
		}
	}

	async fetchTranscript(token, docId) {
		try {
			const response = await obsidian.requestUrl({
				url: `https://api.granola.ai/v1/get-document-transcript`,
				method: 'POST',
				headers: {
					'Authorization': 'Bearer ' + token,
					'Content-Type': 'application/json',
					'Accept': 'application/json',
				},
				body: JSON.stringify({
					'document_id': docId
				})
			});

			return response.json;

		} catch (error) {
			console.error('Error fetching transcript for document ' + docId + ':' + error);
			return null;
		}
	}

	convertProseMirrorToMarkdown(content) {
		if (!content || typeof content !== 'object' || !content.content) {
			return '';
		}

		const processNode = (node, indentLevel = 0) => {
			if (!node || typeof node !== 'object') {
				return '';
			}

			const nodeType = node.type || '';
			const nodeContent = node.content || [];
			const text = node.text || '';

			if (nodeType === 'heading') {
				const level = node.attrs && node.attrs.level ? node.attrs.level : 1;
				const headingText = nodeContent.map(child => processNode(child, indentLevel)).join('');
				return '#'.repeat(level) + ' ' + headingText + '\n\n';
			} else if (nodeType === 'paragraph') {
				const paraText = nodeContent.map(child => processNode(child, indentLevel)).join('');
				return paraText + '\n\n';
			} else if (nodeType === 'bulletList') {
				const items = [];
				for (let i = 0; i < nodeContent.length; i++) {
					const item = nodeContent[i];
					if (item.type === 'listItem') {
						const processedItem = this.processListItem(item, indentLevel);
						if (processedItem) {
							items.push(processedItem);
						}
					}
				}
				return items.join('\n') + '\n\n';
			} else if (nodeType === 'text') {
				return text;
			} else {
				return nodeContent.map(child => processNode(child, indentLevel)).join('');
			}
		};

		return processNode(content);
	}

	processListItem(listItem, indentLevel = 0) {
		if (!listItem || !listItem.content) {
			return '';
		}

		const indent = '  '.repeat(indentLevel); // 2 spaces per indent level
		let itemText = '';
		let hasNestedLists = false;

		for (const child of listItem.content) {
			if (child.type === 'paragraph') {
				// Process paragraph content for the main bullet text
				const paraText = (child.content || []).map(node => {
					if (node.type === 'text') {
						return node.text || '';
					}
					return '';
				}).join('').trim();
				if (paraText) {
					itemText += paraText;
				}
			} else if (child.type === 'bulletList') {
				// Handle nested bullet lists
				hasNestedLists = true;
				const nestedItems = [];
				for (const nestedItem of child.content || []) {
					if (nestedItem.type === 'listItem') {
						const nestedProcessed = this.processListItem(nestedItem, indentLevel + 1);
						if (nestedProcessed) {
							nestedItems.push(nestedProcessed);
						}
					}
				}
				if (nestedItems.length > 0) {
					itemText += '\n' + nestedItems.join('\n');
				}
			}
		}

		if (!itemText.trim()) {
			return '';
		}

		// Format the main bullet point
		const mainBullet = indent + '- ' + itemText.split('\n')[0];
		
		// If there are nested items, append them
		if (hasNestedLists) {
			const lines = itemText.split('\n');
			if (lines.length > 1) {
				const nestedLines = lines.slice(1).join('\n');
				return mainBullet + '\n' + nestedLines;
			}
		}

		return mainBullet;
	}

	formatDate(date, format) {
		if (!date) return '';
		
		const d = new Date(date);
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		const hours = String(d.getHours()).padStart(2, '0');
		const minutes = String(d.getMinutes()).padStart(2, '0');
		const seconds = String(d.getSeconds()).padStart(2, '0');
		
		return format
			.replace(/YYYY/g, year)
			.replace(/YY/g, String(year).slice(-2))
			.replace(/MM/g, month)
			.replace(/DD/g, day)
			.replace(/HH/g, hours)
			.replace(/mm/g, minutes)
			.replace(/ss/g, seconds);
	}

	generateNoteTitle(doc) {
		const title = doc.title || 'Untitled Granola Note';
		// Clean the title for use as a heading - remove invalid characters but keep spaces
		return title.replace(/[<>:"/\\|?*]/g, '').trim();
	}

	generateFilename(doc) {
		const title = doc.title || 'Untitled Granola Note';
		const docId = doc.id || 'unknown_id';
		
		let createdDate = '';
		let updatedDate = '';
		let createdTime = '';
		let updatedTime = '';
		let createdDateTime = '';
		let updatedDateTime = '';
		
		if (doc.created_at) {
			createdDate = this.formatDate(doc.created_at, this.settings.dateFormat);
			createdTime = this.formatDate(doc.created_at, 'HH-mm-ss');
			createdDateTime = this.formatDate(doc.created_at, this.settings.dateFormat + '_HH-mm-ss');
		}
		
		if (doc.updated_at) {
			updatedDate = this.formatDate(doc.updated_at, this.settings.dateFormat);
			updatedTime = this.formatDate(doc.updated_at, 'HH-mm-ss');
			updatedDateTime = this.formatDate(doc.updated_at, this.settings.dateFormat + '_HH-mm-ss');
		}

		let filename = this.settings.filenameTemplate
			.replace(/{title}/g, title)
			.replace(/{id}/g, docId)
			.replace(/{created_date}/g, createdDate)
			.replace(/{updated_date}/g, updatedDate)
			.replace(/{created_time}/g, createdTime)
			.replace(/{updated_time}/g, updatedTime)
			.replace(/{created_datetime}/g, createdDateTime)
			.replace(/{updated_datetime}/g, updatedDateTime);

		if (this.settings.notePrefix) {
			filename = this.settings.notePrefix + filename;
		}

		const invalidChars = /[<>:"/\\|?*]/g;
		filename = filename.replace(invalidChars, '');
		// filename = filename.replace(/\s+/g, '_');
		
		return filename;
	}

	generateDateBasedPath(doc) {
		if (!this.settings.enableDateBasedFolders || !doc.created_at) {
			return this.settings.syncDirectory;
		}

		const dateFolder = this.formatDate(doc.created_at, this.settings.dateFolderFormat);
		return path.join(this.settings.syncDirectory, dateFolder);
	}

	async ensureDateBasedDirectoryExists(datePath) {
		try {
			const folder = this.app.vault.getFolderByPath(datePath);
			if (!folder) {
				await this.app.vault.createFolder(datePath);
			}
		} catch (error) {
			console.error('Error creating date-based directory:', datePath, error);
		}
	}

	/**
	 * Finds an existing note by its Granola ID based on the configured search scope.
	 * 
	 * Search scope options:
	 * - 'syncDirectory' (default): Only searches within the configured sync directory
	 * - 'entireVault': Searches all markdown files in the vault
	 * - 'specificFolders': Searches within user-specified folders (including subfolders)
	 * 
	 * This allows users to move their Granola notes to different folders while still
	 * avoiding duplicates when "Skip Existing Notes" is enabled.
	 * 
	 * @param {string} granolaId - The Granola ID to search for
	 * @returns {TFile|null} The found file or null if not found
	 */
		async findExistingNoteByGranolaId(granolaId) {
		let filesToSearch = [];

		if (this.settings.existingNoteSearchScope === 'entireVault') {
			// Search all markdown files in the vault
			filesToSearch = this.app.vault.getMarkdownFiles();
		} else if (this.settings.existingNoteSearchScope === 'specificFolders') {
			// Search in specific folders
			if (this.settings.specificSearchFolders.length === 0) {
			return null;
		}

			for (const folderPath of this.settings.specificSearchFolders) {
				const folder = this.app.vault.getFolderByPath(folderPath);
				if (folder) {
					const folderFiles = this.getAllMarkdownFilesInFolder(folder);
					filesToSearch = filesToSearch.concat(folderFiles);
				}
			}
		} else {
			// Default: search only in sync directory
			const folder = this.app.vault.getFolderByPath(this.settings.syncDirectory);
			if (!folder) {
				return null;
			}
			filesToSearch = folder.children.filter(file => file instanceof obsidian.TFile && file.extension === 'md');
		}
		
		for (const file of filesToSearch) {
			try {
				const content = await this.app.vault.read(file);
				const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
				
				if (frontmatterMatch) {
					const frontmatter = frontmatterMatch[1];
					const granolaIdMatch = frontmatter.match(/granola_id:\s*(.+)$/m);
					
					if (granolaIdMatch && granolaIdMatch[1].trim() === granolaId) {
						return file;
					}
				}
			} catch (error) {
				console.error('Error reading file for Granola ID check:', file.path, error);
			}
		}
		
		return null;
	}

	getAllMarkdownFilesInFolder(folder) {
		const files = [];
		
		// Safety check - ensure folder exists
		if (!folder) {
			return files;
		}
		
		// Use Vault.recurseChildren to get all markdown files in folder and subfolders
		this.app.vault.recurseChildren(folder, (file) => {
			if (file instanceof obsidian.TFile && file.extension === 'md') {
				files.push(file);
			}
		});
		
		return files;
	}

	/**
	 * Gets all folder paths in the vault (useful for future UI improvements)
	 * @returns {string[]} Array of folder paths
	 */
	getAllFolderPaths() {
		const allFolders = this.app.vault.getAllFolders();
		return allFolders.map(folder => folder.path).sort();
	}

	async findDuplicateNotes() {
		try {
			// Get all markdown files in the vault
			const allFiles = this.app.vault.getMarkdownFiles();
			const granolaFiles = {};
			const duplicates = [];
			
			// Check each file for granola-id
			for (const file of allFiles) {
				try {
					const content = await this.app.vault.read(file);
					const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
					
					if (frontmatterMatch) {
						const frontmatter = frontmatterMatch[1];
						const granolaIdMatch = frontmatter.match(/granola_id:\s*(.+)$/m);
						
						if (granolaIdMatch) {
							const granolaId = granolaIdMatch[1].trim();
							
							if (granolaFiles[granolaId]) {
								// Found a duplicate
								if (!duplicates.some(d => d.granolaId === granolaId)) {
									duplicates.push({
										granolaId: granolaId,
										files: [granolaFiles[granolaId], file]
									});
								} else {
									// Add to existing duplicate group
									const duplicate = duplicates.find(d => d.granolaId === granolaId);
									duplicate.files.push(file);
								}
							} else {
								granolaFiles[granolaId] = file;
							}
						}
					}
				} catch (error) {
					console.error('Error reading file:', file.path, error);
				}
			}
			
			if (duplicates.length === 0) {
				new obsidian.Notice('No duplicate Granola notes found! 🎉');
			} else {
				
				// Create a summary message
				let message = `Found ${duplicates.length} set(s) of duplicate Granola notes:\n\n`;
				
				for (const duplicate of duplicates) {
					message += `Granola ID: ${duplicate.granolaId}\n`;
					for (const file of duplicate.files) {
						message += `  • ${file.path}\n`;
					}
					message += '\n';
				}
				
				message += 'Check the console for full details. You can manually delete the duplicates you don\'t want to keep.';
				
				new obsidian.Notice(message, 10000); // Show for 10 seconds
			}
			
		} catch (error) {
			console.error('Error finding duplicate notes:', error);
			new obsidian.Notice('Error finding duplicate notes. Check console for details.');
		}
	}

	async processDocument(doc) {
		try {
			const title = doc.title || 'Untitled Granola Note';
			const docId = doc.id || 'unknown_id';
			const transcript = doc.transcript || 'no_transcript';

			let contentToParse = null;
			if (doc.last_viewed_panel && doc.last_viewed_panel.content && doc.last_viewed_panel.content.type === 'doc') {
				contentToParse = doc.last_viewed_panel.content;
			}

			if (!contentToParse) {
				return false;
			}

			// Check if note already exists by Granola ID
			const existingFile = await this.findExistingNoteByGranolaId(docId);
			
			if (existingFile) {
				// Check if we should skip existing notes completely
				const shouldUpdateMetadata = this.settings.includeAttendeeTags || this.settings.includeGranolaUrl;
				
				if (this.settings.skipExistingNotes && !shouldUpdateMetadata) {
					return true; // Return true so it counts as "synced" but we don't update
				}
				
				if (this.settings.skipExistingNotes && shouldUpdateMetadata) {
					// Only update metadata (tags, URLs), preserve existing content
					// Note: Default tags are NOT added when skipExistingNotes is true
					try {
						await this.updateExistingNoteMetadata(existingFile, doc);
						return true;
					} catch (error) {
						console.error('Error updating metadata for existing note:', error);
						return false;
					}
				}

				// Update existing note (full update)
				try {
					const markdownContent = this.convertProseMirrorToMarkdown(contentToParse);

					// Extract attendee information
					const attendeeNames = this.extractAttendeeNames(doc);
					const attendeeTags = this.generateAttendeeTags(attendeeNames);
					
					// Extract folder information
					const folderNames = this.extractFolderNames(doc);
					const folderTags = this.generateFolderTags(folderNames);
					
					// Generate Granola URL
					const granolaUrl = this.generateGranolaUrl(docId);
					

					// Combine all tags (attendee, folder, and default tags)
					const allTags = [...attendeeTags, ...folderTags, ...this.settings.defaultTags];

					// Create frontmatter with original title
					let frontmatter = '---\n';
					frontmatter += 'granola_id: ' + docId + '\n';
					const escapedTitle = title.replace(/"/g, '\\"');
					frontmatter += 'title: "' + escapedTitle + '"\n';
					
					if (granolaUrl) {
						frontmatter += 'granola_url: "' + granolaUrl + '"\n';
					}
					
					if (doc.created_at) {
						frontmatter += 'created_at: ' + doc.created_at + '\n';
					}
					if (doc.updated_at) {
						frontmatter += 'updated_at: ' + doc.updated_at + '\n';
					}
					
					// Add all tags if any were found
					if (allTags.length > 0) {
						frontmatter += 'tags:\n';
						for (const tag of allTags) {
							frontmatter += '  - ' + tag + '\n';
						}
					}
					
					// Add custom properties (this is for updating existing notes in full update mode)
					frontmatter = this.addCustomPropertiesToFrontmatter(frontmatter, false, doc);
					
					frontmatter += '---\n\n';

					// Use the note title (clean, with proper spacing) for the heading
					const noteTitle = this.generateNoteTitle(doc);
					let finalMarkdown = frontmatter + '# ' + noteTitle + '\n\n' + markdownContent;
					// Add transcript section if enabled and transcript is available
					if (this.settings.includeFullTranscript) {
						finalMarkdown += '\n\n# Transcript\n\n' + transcript;
					}
					
					await this.app.vault.process(existingFile, () => finalMarkdown);
					return true;
				} catch (updateError) {
					console.error('Error updating existing note:', updateError);
					return false;
				}
			}

			// Create new note
			const markdownContent = this.convertProseMirrorToMarkdown(contentToParse);
			
			// Extract attendee information
			const attendeeNames = this.extractAttendeeNames(doc);
			const attendeeTags = this.generateAttendeeTags(attendeeNames);
			
			// Extract folder information
			const folderNames = this.extractFolderNames(doc);
			const folderTags = this.generateFolderTags(folderNames);
			
			// Generate Granola URL
			const granolaUrl = this.generateGranolaUrl(docId);
			


			// Combine all tags (attendee, folder, and default tags)
			const allTags = [...attendeeTags, ...folderTags, ...this.settings.defaultTags];

			let frontmatter = '---\n';
			frontmatter += 'granola_id: ' + docId + '\n';
			const escapedTitle = title.replace(/"/g, '\\"');
			frontmatter += 'title: "' + escapedTitle + '"\n';
			
			if (granolaUrl) {
				frontmatter += 'granola_url: "' + granolaUrl + '"\n';
			}
			
			if (doc.created_at) {
				frontmatter += 'created_at: ' + doc.created_at + '\n';
			}
			if (doc.updated_at) {
				frontmatter += 'updated_at: ' + doc.updated_at + '\n';
			}
			
			// Add all tags if any were found
			if (allTags.length > 0) {
				frontmatter += 'tags:\n';
				for (const tag of allTags) {
					frontmatter += '  - ' + tag + '\n';
				}
			}
			
			// Add custom properties (this is for new notes)
			frontmatter = this.addCustomPropertiesToFrontmatter(frontmatter, false, doc);
			
			frontmatter += '---\n\n';

			let finalMarkdown = frontmatter + markdownContent;
			// Add transcript section if enabled and transcript is available
			if (this.settings.includeFullTranscript) {
				finalMarkdown += '\n\n# Transcript\n\n' + transcript;
			}

			const filename = this.generateFilename(doc) + '.md';
			// Use date-based path if enabled, otherwise use sync directory
			const targetDirectory = this.generateDateBasedPath(doc);
			const filepath = path.join(targetDirectory, filename);

			await this.ensureDateBasedDirectoryExists(targetDirectory);

			// Check if file with same name already exists
			let finalFilepath = filepath;
			const existingFileByName = this.app.vault.getAbstractFileByPath(filepath);
			if (existingFileByName) {
				// Create a unique filename by appending timestamp or ID
				const createdDate = new Date(doc.created_at);
				const timestamp = this.formatDate(doc.created_at, 'HH-mm');
				const baseFilename = this.generateFilename(doc);
				const uniqueFilename = baseFilename + '_' + timestamp + '.md'; 
				finalFilepath = path.join(targetDirectory, uniqueFilename);
				
				// Check if the unique filename also exists
				const existingUniqueFile = this.app.vault.getAbstractFileByPath(finalFilepath);
				if (existingUniqueFile) {
					return false;
				}
			}

			await this.app.vault.create(finalFilepath, finalMarkdown);
			return true;

		} catch (error) {
			console.error('Error processing document:', error);
			return false;
		}
	}

	async ensureDirectoryExists() {
		try {
			const folder = this.app.vault.getFolderByPath(this.settings.syncDirectory);
			if (!folder) {
				await this.app.vault.createFolder(this.settings.syncDirectory);
			}
		} catch (error) {
			console.error('Error creating directory:', error);
		}
	}

	async updateDailyNote(todaysNotes) {
		try {
			const dailyNote = await this.getDailyNote();
			if (!dailyNote) {
				console.log('No daily note found, skipping daily note integration');
				return;
			}

			let content = await this.app.vault.read(dailyNote);
			
			const sectionHeader = this.settings.dailyNoteSectionName;
			
			const notesList = todaysNotes
				.sort((a, b) => a.time.localeCompare(b.time))
				.map(note => '- ' + note.time + ' [[' + note.actualFilePath + '|' + note.title + ']]')
				.join('\n');
			
			const granolaSection = sectionHeader + '\n' + notesList;

			// Use MetadataCache to find existing headings
			const fileCache = this.app.metadataCache.getFileCache(dailyNote);
			const headings = fileCache?.headings || [];
			
			// Look for existing section by heading text
			const existingHeading = headings.find(heading => 
				heading.heading.trim() === sectionHeader.replace(/^#+\s*/, '').trim()
			);
			
			if (existingHeading) {
				// Found existing section, replace content
				const lines = content.split('\n');
				const sectionLineNum = existingHeading.position.start.line;
				
				// Find the end of this section (next heading of same or higher level, or end of file)
				let endLineNum = lines.length;
				for (const heading of headings) {
					if (heading.position.start.line > sectionLineNum && heading.level <= existingHeading.level) {
						endLineNum = heading.position.start.line;
						break;
					}
				}
				
				const beforeSection = lines.slice(0, sectionLineNum).join('\n');
				const afterSection = lines.slice(endLineNum).join('\n');
				content = beforeSection + '\n' + granolaSection + '\n' + afterSection;
			} else {
				// Section not found, append to end
				content += '\n\n' + granolaSection;
			}

			await this.app.vault.process(dailyNote, () => content);
			
		} catch (error) {
			console.error('Error updating daily note:', error);
		}
	}

	async updatePeriodicNote(todaysNotes) {
		try {
			const periodicNote = await this.getPeriodicNote();
			if (!periodicNote) {
				console.log('No periodic note found, skipping periodic note integration');
				return;
			}

			let content = await this.app.vault.read(periodicNote);
			
			const sectionHeader = this.settings.periodicNoteSectionName;
			
			const notesList = todaysNotes
				.sort((a, b) => a.time.localeCompare(b.time))
				.map(note => '- ' + note.time + ' [[' + note.actualFilePath + '|' + note.title + ']]')
				.join('\n');
			
			const granolaSection = sectionHeader + '\n' + notesList;

			// Use MetadataCache to find existing headings
			const fileCache = this.app.metadataCache.getFileCache(periodicNote);
			const headings = fileCache?.headings || [];
			
			// Look for existing section by heading text
			const existingHeading = headings.find(heading => 
				heading.heading.trim() === sectionHeader.replace(/^#+\s*/, '').trim()
			);
			
			if (existingHeading) {
				// Found existing section, replace content
				const lines = content.split('\n');
				const sectionLineNum = existingHeading.position.start.line;
				
				// Find the end of this section (next heading of same or higher level, or end of file)
				let endLineNum = lines.length;
				for (const heading of headings) {
					if (heading.position.start.line > sectionLineNum && heading.level <= existingHeading.level) {
						endLineNum = heading.position.start.line;
						break;
					}
				}
				
				const beforeSection = lines.slice(0, sectionLineNum).join('\n');
				const afterSection = lines.slice(endLineNum).join('\n');
				content = beforeSection + '\n' + granolaSection + '\n' + afterSection;
			} else {
				// Section not found, append to end
				content += '\n\n' + granolaSection;
			}

			await this.app.vault.process(periodicNote, () => content);
			
		} catch (error) {
			console.error('Error updating periodic note:', error);
		}
	}

	async getDailyNote() {
		try {
			// Try to get today's daily note using a simpler approach
			const today = new Date();
			const todayFormatted = today.toISOString().split('T')[0]; // YYYY-MM-DD format
			
			// Generate various date formats to search for
			const year = today.getFullYear();
			const month = String(today.getMonth() + 1).padStart(2, '0');
			const day = String(today.getDate()).padStart(2, '0');
			
			// Common date formats in daily notes
			const searchFormats = [
				`${day}-${month}-${year}`, // DD-MM-YYYY
				`${year}-${month}-${day}`, // YYYY-MM-DD  
				`${month}-${day}-${year}`, // MM-DD-YYYY
				`${day}.${month}.${year}`, // DD.MM.YYYY
				`${year}/${month}/${day}`, // YYYY/MM/DD
				`${day}/${month}/${year}`, // DD/MM/YYYY
			];
			
			// Search through all files in the vault to find today's daily note
			const files = this.app.vault.getMarkdownFiles();
			
			for (const file of files) {
				// Check if this file is in the daily notes structure and matches any of today's date formats
				if (file.path.includes('Daily')) {
					for (const dateFormat of searchFormats) {
						if (file.path.includes(dateFormat)) {
							return file;
						}
					}
				}
			}
			
			return null;
		} catch (error) {
			console.error('Error getting daily note:', error);
			return null;
		}
	}

	isPeriodicNotesPluginAvailable() {
		return this.app.plugins.enabledPlugins.has('periodic-notes');
	}

	async getPeriodicNote() {
		try {
			if (!this.isPeriodicNotesPluginAvailable()) {
				console.log('Periodic Notes plugin not available');
				return null;
			}

			const periodicNotesPlugin = this.app.plugins.plugins['periodic-notes'];
			if (!periodicNotesPlugin || !periodicNotesPlugin.api) {
				console.log('Periodic Notes plugin API not accessible');
				return null;
			}

			// Get today's date using the same moment instance that Periodic Notes uses
			const today = window.moment ? window.moment() : null;
			if (!today) {
				console.log('Moment.js not available for Periodic Notes integration');
				return null;
			}

			// Try daily note first (most common case)
			const { createDailyNote, getDailyNote } = periodicNotesPlugin.api;
			if (getDailyNote && createDailyNote) {
				try {
					let dailyNote = getDailyNote(today, false);
					if (!dailyNote) {
						dailyNote = await createDailyNote(today);
					}
					if (dailyNote) {
						console.log('Found/created periodic daily note');
						return dailyNote;
					}
				} catch (dailyError) {
					console.log('Failed to get daily periodic note:', dailyError);
				}
			}

			// Fallback to weekly note
			const { createWeeklyNote, getWeeklyNote } = periodicNotesPlugin.api;
			if (getWeeklyNote && createWeeklyNote) {
				try {
					let weeklyNote = getWeeklyNote(today, false);
					if (!weeklyNote) {
						weeklyNote = await createWeeklyNote(today);
					}
					if (weeklyNote) {
						console.log('Found/created periodic weekly note');
						return weeklyNote;
					}
				} catch (weeklyError) {
					console.log('Failed to get weekly periodic note:', weeklyError);
				}
			}

			// Fallback to monthly note
			const { createMonthlyNote, getMonthlyNote } = periodicNotesPlugin.api;
			if (getMonthlyNote && createMonthlyNote) {
				try {
					let monthlyNote = getMonthlyNote(today, false);
					if (!monthlyNote) {
						monthlyNote = await createMonthlyNote(today);
					}
					if (monthlyNote) {
						console.log('Found/created periodic monthly note');
						return monthlyNote;
					}
				} catch (monthlyError) {
					console.log('Failed to get monthly periodic note:', monthlyError);
				}
			}

			console.log('No periodic note could be found or created');
			return null;
		} catch (error) {
			console.error('Error getting periodic note:', error);
			return null;
		}
	}

	extractAttendeeNames(doc) {
		const attendees = [];
		const processedEmails = new Set(); // Track processed emails to avoid duplicates
		
		try {
			// Check the people field for attendee information (enhanced with detailed person data)
			if (doc.people && Array.isArray(doc.people)) {
				for (const person of doc.people) {
					let name = null;
					
					// Try to get name from various fields
					if (person.name) {
						name = person.name;
					} else if (person.display_name) {
						name = person.display_name;
					} else if (person.details && person.details.person && person.details.person.name) {
						// Use the detailed person information if available
						const personDetails = person.details.person.name;
						if (personDetails.fullName) {
							name = personDetails.fullName;
						} else if (personDetails.givenName && personDetails.familyName) {
							name = `${personDetails.givenName} ${personDetails.familyName}`;
						} else if (personDetails.givenName) {
							name = personDetails.givenName;
						}
					} else if (person.email) {
						// Extract name from email if no display name
						const emailName = person.email.split('@')[0].replace(/[._]/g, ' ');
						name = emailName;
					}
					
					if (name && !attendees.includes(name)) {
						attendees.push(name);
						if (person.email) {
							processedEmails.add(person.email);
						}
					}
				}
			}
			
			// Also check google_calendar_event for additional attendee info
			if (doc.google_calendar_event && doc.google_calendar_event.attendees) {
				for (const attendee of doc.google_calendar_event.attendees) {
					// Skip if we've already processed this email
					if (attendee.email && processedEmails.has(attendee.email)) {
						continue;
					}
					
					if (attendee.displayName && !attendees.includes(attendee.displayName)) {
						attendees.push(attendee.displayName);
						if (attendee.email) {
							processedEmails.add(attendee.email);
						}
					} else if (attendee.email && !attendees.some(name => name.includes(attendee.email.split('@')[0]))) {
						const emailName = attendee.email.split('@')[0].replace(/[._]/g, ' ');
						attendees.push(emailName);
						processedEmails.add(attendee.email);
					}
				}
			}
			
			return attendees;
		} catch (error) {
			console.error('Error extracting attendee names:', error);
			return [];
		}
	}

	generateAttendeeTags(attendees) {
		if (!this.settings.includeAttendeeTags || !attendees || attendees.length === 0) {
			return [];
		}
		
		const tags = [];
		
		for (const attendee of attendees) {
			// Skip if this is the user's own name (case-insensitive, exact match)
			if (this.settings.excludeMyNameFromTags && this.settings.myName && 
				attendee.toLowerCase().trim() === this.settings.myName.toLowerCase().trim()) {
				continue;
			}
			
			// Convert name to valid tag format
			// Remove special characters, replace spaces with hyphens, convert to lowercase
			let cleanName = attendee
				.replace(/[^\w\s-]/g, '') // Remove special chars except spaces and hyphens
				.trim()
				.replace(/\s+/g, '-') // Replace spaces with hyphens
				.toLowerCase();
			
			// Use the customizable tag template
			let tag = this.settings.attendeeTagTemplate.replace('{name}', cleanName);
			
			// Ensure the tag is valid (no double slashes, etc.)
			tag = tag.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
			
			if (tag && !tags.includes(tag)) {
				tags.push(tag);
			}
		}
		
		return tags;
	}

	extractFolderNames(doc) {
		// Note: Folder functionality is currently disabled as folder information 
		// is not available in the Granola API response. This method is kept for future use.
		return [];
		
		/* 
		// Code preserved for when Granola API includes folder information
		const folderNames = [];
		
		try {
			// Handle single workspace_id
			if (doc.workspace_id && this.workspaces) {
				const folderName = this.findWorkspaceName(doc.workspace_id);
				if (folderName) {
					folderNames.push(folderName);
				}
			}
			
			// Handle multiple workspace IDs (if they exist)
			if (doc.workspace_ids && Array.isArray(doc.workspace_ids) && this.workspaces) {
				doc.workspace_ids.forEach(wsId => {
					const folderName = this.findWorkspaceName(wsId);
					if (folderName && !folderNames.includes(folderName)) {
						folderNames.push(folderName);
					}
				});
			}
			
			// Handle list IDs (single and multiple)
			if (doc.list_id && this.workspaces) {
				const folderName = this.findWorkspaceName(doc.list_id);
				if (folderName && !folderNames.includes(folderName)) {
					folderNames.push(folderName);
				}
			}
			
			if (doc.list_ids && Array.isArray(doc.list_ids) && this.workspaces) {
				doc.list_ids.forEach(listId => {
					const folderName = this.findWorkspaceName(listId);
					if (folderName && !folderNames.includes(folderName)) {
						folderNames.push(folderName);
					}
				});
			}
			
			// Check legacy folder properties
			const legacyFields = ['folder_name', 'folder', 'directory'];
			legacyFields.forEach(field => {
				if (doc[field] && !folderNames.includes(doc[field])) {
					folderNames.push(doc[field]);
				}
			});
			
			return folderNames;
		} catch (error) {
			console.error('Error extracting folder names:', error);
			return [];
		}
		*/
	}

	findWorkspaceName(workspaceId) {
		if (!this.workspaces || !workspaceId) {
			return null;
		}
		
		try {
			// Try different possible structures for workspaces response
			if (Array.isArray(this.workspaces)) {
				const workspace = this.workspaces.find(ws => ws.id === workspaceId);
				if (workspace && workspace.name) {
					return workspace.name;
				}
			} else if (this.workspaces.workspaces && Array.isArray(this.workspaces.workspaces)) {
				const workspace = this.workspaces.workspaces.find(ws => ws.id === workspaceId);
				if (workspace && workspace.name) {
					return workspace.name;
				}
			} else if (this.workspaces.lists && Array.isArray(this.workspaces.lists)) {
				const list = this.workspaces.lists.find(l => l.id === workspaceId);
				if (list && list.name) {
					return list.name;
				}
			}
			
			return null;
		} catch (error) {
			console.error('Error finding workspace name:', error);
			return null;
		}
	}

	generateFolderTags(folderNames) {
		if (!this.settings.includeFolderTags || !folderNames || folderNames.length === 0) {
			return [];
		}
		
		try {
			const tags = [];
			
			for (const folderName of folderNames) {
				if (!folderName) continue;
				
				// Convert folder name to valid tag format
				// Remove special characters, replace spaces with hyphens, convert to lowercase
				let tag = folderName
					.replace(/[^\w\s-]/g, '') // Remove special chars except spaces and hyphens
					.trim()
					.replace(/\s+/g, '-') // Replace spaces with hyphens
					.toLowerCase();
				
				// Add folder/ prefix for better organization
				tag = 'folder/' + tag;
				
				if (tag && tag !== 'folder/' && !tags.includes(tag)) {
					tags.push(tag);
				}
			}
			
			return tags;
		} catch (error) {
			console.error('Error generating folder tags:', error);
			return [];
		}
	}

	generateGranolaUrl(docId) {
		if (!this.settings.includeGranolaUrl || !docId) {
			return null;
		}
		
		try {
			// Construct the Granola notes URL using the correct format
			return `https://notes.granola.ai/d/${docId}`;
		} catch (error) {
			console.error('Error generating Granola URL:', error);
			return null;
		}
	}

	addCustomPropertiesToFrontmatter(frontmatter, isExistingNote = false, doc = null) {
		// Skip custom properties if this is an existing note and skipExistingNotes is enabled
		if (isExistingNote && this.settings.skipExistingNotes) {
			return frontmatter;
		}
		
		// Add automatic date property from created_at using user's date format
		if (doc && doc.created_at) {
			const datePropertyPattern = /^date:\s/m;
			if (!datePropertyPattern.test(frontmatter)) {
				const formattedDate = this.formatDate(doc.created_at, this.settings.dateFormat);
				frontmatter += `date: ${formattedDate}\n`;
			}
		}
		
		// Add custom properties if any are configured
		if (this.settings.customProperties && Object.keys(this.settings.customProperties).length > 0) {
			for (const [key, value] of Object.entries(this.settings.customProperties)) {
				if (key && value) {
					// Check if property already exists in frontmatter (existing properties take priority)
					const propertyPattern = new RegExp(`^${key}:\\s`, 'm');
					if (!propertyPattern.test(frontmatter)) {
						frontmatter += `${key}: ${value}\n`;
					}
				}
			}
		}
		return frontmatter;
	}

	async updateExistingNoteMetadata(file, doc) {
		try {
			// Extract all metadata
			const attendeeNames = this.extractAttendeeNames(doc);
			const attendeeTags = this.generateAttendeeTags(attendeeNames);
			const folderNames = this.extractFolderNames(doc);
			const folderTags = this.generateFolderTags(folderNames);
			const granolaUrl = this.generateGranolaUrl(doc.id);
			
			// Use FileManager.processFrontMatter for atomic frontmatter updates
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				// Preserve existing tags that are not person or folder tags
				// Keep default tags since we're not updating them when skipExistingNotes is true
				const existingTags = frontmatter.tags || [];
				const preservedTags = existingTags.filter(tag => 
					!tag.startsWith('person/') && 
					!tag.startsWith('folder/')
				);
				
				// Combine attendee and folder tags only (no default tags when skipExistingNotes is true)
				const newTags = [...attendeeTags, ...folderTags];
				
				// Update tags
				frontmatter.tags = [...preservedTags, ...newTags];
				
				// Update or add Granola URL if enabled
				if (granolaUrl) {
					frontmatter.granola_url = granolaUrl;
				}
				
				// Add automatic date property if not present and skipExistingNotes allows it
				if (!this.settings.skipExistingNotes && doc.created_at && !frontmatter.date) {
					frontmatter.date = this.formatDate(doc.created_at, this.settings.dateFormat);
				}
				
				// Add custom properties if skipExistingNotes allows it
				if (!this.settings.skipExistingNotes && this.settings.customProperties) {
					for (const [key, value] of Object.entries(this.settings.customProperties)) {
						if (key && value && !frontmatter[key]) {
							frontmatter[key] = value;
						}
					}
				}
				
				// Note: When skipExistingNotes is true, custom properties and date are NOT added
				// Existing custom properties in the note are always preserved
			});
			
		} catch (error) {
			console.error('Error updating attendee tags for existing note:', error);
			throw error;
		}
	}
}

class GranolaSyncSettingTab extends obsidian.PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const containerEl = this.containerEl;
		containerEl.empty();

		new obsidian.Setting(containerEl)
			.setName('Note prefix')
			.setDesc('Optional prefix to add to all synced note titles')
			.addText(text => {
				text.setPlaceholder('granola-');
				text.setValue(this.plugin.settings.notePrefix);
				text.onChange(async (value) => {
					this.plugin.settings.notePrefix = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Auth key path')
			.setDesc('Path to your Granola authentication key file')
			.addText(text => {
				text.setPlaceholder(getDefaultAuthPath());
				text.setValue(this.plugin.settings.authKeyPath);
				text.onChange(async (value) => {
					this.plugin.settings.authKeyPath = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Date format')
			.setDesc('Format for dates in filenames. Use YYYY (year), MM (month), DD (day)')
			.addText(text => {
				text.setPlaceholder('YYYY-MM-DD');
				text.setValue(this.plugin.settings.dateFormat);
				text.onChange(async (value) => {
					this.plugin.settings.dateFormat = value;
					await this.plugin.saveSettings();
				});
			});


		new obsidian.Setting(containerEl)
			.setName('Include full transcript')
			.setDesc('Include the full meeting transcript in each note under a "# Transcript" section. This requires an additional API call per note and may slow down sync.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.includeFullTranscript);
				toggle.onChange(async (value) => {
					this.plugin.settings.includeFullTranscript = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Filename template')
			.setDesc('Template for filenames. Use {title}, {created_date}, {updated_date}, etc.')
			.addText(text => {
				text.setPlaceholder('{created_date}_{title}');
				text.setValue(this.plugin.settings.filenameTemplate);
				text.onChange(async (value) => {
					this.plugin.settings.filenameTemplate = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Auto-sync frequency')
			.setDesc('How often to automatically sync notes')
			.addDropdown(dropdown => {
				dropdown.addOption('0', 'Never');
				dropdown.addOption('60000', 'Every 1 minute');
				dropdown.addOption('300000', 'Every 5 minutes');
				dropdown.addOption('600000', 'Every 10 minutes');
				dropdown.addOption('1800000', 'Every 30 minutes');
				dropdown.addOption('3600000', 'Every 1 hour');
				dropdown.addOption('21600000', 'Every 6 hours');
				dropdown.addOption('86400000', 'Every 24 hours');
				
				dropdown.setValue(String(this.plugin.settings.autoSyncFrequency));
				dropdown.onChange(async (value) => {
					this.plugin.settings.autoSyncFrequency = parseInt(value);
					await this.plugin.saveSettings();
					
					const label = this.plugin.getFrequencyLabel(parseInt(value));
					new obsidian.Notice('Auto-sync updated: ' + label);
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Skip existing notes')
			.setDesc('When enabled, notes that already exist will not be updated during sync. Exception: if attendee tags or Granola URLs are enabled, only those metadata will be updated while preserving content. Default tags are NOT added to existing notes when this is enabled.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.skipExistingNotes);
				toggle.onChange(async (value) => {
					this.plugin.settings.skipExistingNotes = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Enable date-based folders')
			.setDesc('Organize notes into subfolders based on their creation date')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.enableDateBasedFolders);
				toggle.onChange(async (value) => {
					this.plugin.settings.enableDateBasedFolders = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Date folder format')
			.setDesc('Format for date-based folder structure. Examples: "YYYY-MM-DD" or "YYYY/MM/DD" subfolders')
			.addText(text => {
				text.setPlaceholder('YYYY/MM/DD');
				text.setValue(this.plugin.settings.dateFolderFormat);
				text.onChange(async (value) => {
					this.plugin.settings.dateFolderFormat = value || 'YYYY/MM/DD';
					await this.plugin.saveSettings();
				});
			});

		// Create experimental section header
		containerEl.createEl('h4', {text: '🧪 Experimental features'});
		
		const experimentalWarning = containerEl.createEl('div', { cls: 'setting-item' });
		experimentalWarning.createEl('div', { cls: 'setting-item-info' });
		const warningNameEl = experimentalWarning.createEl('div', { cls: 'setting-item-name' });
		warningNameEl.setText('⚠️ Please backup your vault');
		const warningDescEl = experimentalWarning.createEl('div', { cls: 'setting-item-description' });
		warningDescEl.setText('⚠️ The features below are experimental and may create duplicate notes if not used carefully. Please backup your vault before changing these settings.');

		new obsidian.Setting(containerEl)
			.setName('Search scope for existing notes')
			.setDesc('Choose where to search for existing notes when checking granola-id. "Sync directory only" (default) only checks the configured sync folder. "Entire vault" allows you to move notes anywhere in your vault. "Specific folders" lets you choose which folders to search.')
			.addDropdown(dropdown => {
				dropdown.addOption('syncDirectory', 'Sync directory only (default)');
				dropdown.addOption('entireVault', 'Entire vault');
				dropdown.addOption('specificFolders', 'Specific folders');
				
				dropdown.setValue(this.plugin.settings.existingNoteSearchScope);
				dropdown.onChange(async (value) => {
					const oldValue = this.plugin.settings.existingNoteSearchScope;
					this.plugin.settings.existingNoteSearchScope = value;
					
					// Save settings without triggering auto-sync to prevent duplicates
					await this.plugin.saveSettingsWithoutSync();
					
					// Show warning if search scope changed
					if (oldValue !== value) {
						new obsidian.Notice('Search scope changed. Consider running a manual sync to test the new settings before relying on auto-sync.');
					}
					
					this.display(); // Refresh the settings display
				});
			});

		// Show folder selection only when 'specificFolders' is selected
		if (this.plugin.settings.existingNoteSearchScope === 'specificFolders') {
			new obsidian.Setting(containerEl)
				.setName('Specific search folders')
				.setDesc('Enter folder paths to search (one per line). Leave empty to search all folders.')
				.addTextArea(text => {
					text.setPlaceholder('Examples:\nMeetings\nProjects/Work\nDaily Notes');
					text.setValue(this.plugin.settings.specificSearchFolders.join('\n'));
					
					// Save settings immediately on change (without validation and without auto-sync)
					text.onChange(async (value) => {
						const folders = value.split('\n').map(f => f.trim()).filter(f => f.length > 0);
						this.plugin.settings.specificSearchFolders = folders;
						await this.plugin.saveSettingsWithoutSync();
					});
					
					// Validate only when user finishes editing (on blur)
					text.inputEl.addEventListener('blur', () => {
						const value = text.getValue();
						const folders = value.split('\n').map(f => f.trim()).filter(f => f.length > 0);
						
						if (folders.length === 0) {
							return; // Don't validate if no folders specified
						}
						
						// Validate folder paths
						const invalidFolders = [];
						for (const folderPath of folders) {
							const folder = this.app.vault.getFolderByPath(folderPath);
							if (!folder) {
								invalidFolders.push(folderPath);
							}
						}
						
						if (invalidFolders.length > 0) {
							new obsidian.Notice('Warning: These folders do not exist: ' + invalidFolders.join(', '));
						}
					});
				});
		}

		// Add info section about avoiding duplicates
		const infoEl = containerEl.createEl('div', { cls: 'setting-item' });
		infoEl.createEl('div', { cls: 'setting-item-info' });
		const infoNameEl = infoEl.createEl('div', { cls: 'setting-item-name' });
		infoNameEl.setText('⚠️ Avoiding duplicates');
		const infoDescEl = infoEl.createEl('div', { cls: 'setting-item-description' });
		infoDescEl.setText('When changing search scope, existing notes in other locations won\'t be found and may be recreated. To avoid duplicates: 1) Move your existing notes to the new search location first, or 2) Use "Entire Vault" to search everywhere, or 3) Run a manual sync after changing settings to test before auto-sync runs.');

		// Create a heading for metadata settings
		containerEl.createEl('h3', {text: 'Note metadata & tags'});

		new obsidian.Setting(containerEl)
			.setName('Include attendee tags')
			.setDesc('Add meeting attendees as tags in the frontmatter of each note')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.includeAttendeeTags);
				toggle.onChange(async (value) => {
					this.plugin.settings.includeAttendeeTags = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Exclude my name from tags')
			.setDesc('When adding attendee tags, exclude your own name from the list')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.excludeMyNameFromTags);
				toggle.onChange(async (value) => {
					this.plugin.settings.excludeMyNameFromTags = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('My name')
			.setDesc('Your name as it appears in Granola meetings (used to exclude from attendee tags)')
			.addText(text => {
				text.setPlaceholder('Danny McClelland');
				text.setValue(this.plugin.settings.myName);
				text.onChange(async (value) => {
					this.plugin.settings.myName = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Attendee tag template')
			.setDesc('Customize the structure of attendee tags. Use {name} as placeholder for the attendee name. Examples: "person/{name}", "people/{name}", "meeting-attendees/{name}"')
			.addText(text => {
				text.setPlaceholder('person/{name}');
				text.setValue(this.plugin.settings.attendeeTagTemplate);
				text.onChange(async (value) => {
					// Validate the template has {name} placeholder
					if (!value.includes('{name}')) {
						new obsidian.Notice('Warning: Tag template should include {name} placeholder');
					}
					this.plugin.settings.attendeeTagTemplate = value || 'person/{name}';
					await this.plugin.saveSettings();
				});
			});

		// Note: Folder tags setting is temporarily hidden as folder information is not yet available in Granola API
		// new obsidian.Setting(containerEl)
		// 	.setName('Include Folder Tags')
		// 	.setDesc('Add Granola folder/list names as tags in the frontmatter of each note. Supports multiple folders per note (e.g., folder/test-folder, folder/project-alpha)')
		// 	.addToggle(toggle => {
		// 		toggle.setValue(this.plugin.settings.includeFolderTags);
		// 		toggle.onChange(async (value) => {
		// 			this.plugin.settings.includeFolderTags = value;
		// 			await this.plugin.saveSettings();
		// 		});
		// 	});

		new obsidian.Setting(containerEl)
			.setName('Include Granola URL')
			.setDesc('Add a link back to the original Granola note in the frontmatter (e.g., granola_url: "https://notes.granola.ai/d/...")')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.includeGranolaUrl);
				toggle.onChange(async (value) => {
					this.plugin.settings.includeGranolaUrl = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Default tags')
			.setDesc('Tags that will be automatically added to all synced notes (one per line). Example: "meeting", "granola", "work"')
			.addTextArea(text => {
				text.setPlaceholder('meeting\ngranola\nwork');
				text.setValue(this.plugin.settings.defaultTags.join('\n'));
				text.onChange(async (value) => {
					// Split by lines and filter out empty entries
					const tags = value.split('\n')
						.map(tag => tag.trim())
						.filter(tag => tag.length > 0);
					this.plugin.settings.defaultTags = tags;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Custom properties')
			.setDesc('Custom frontmatter properties to add to all synced notes. Format: "property_name: value" (one per line). Example: "project: work", "type: meeting". Existing properties in notes take priority.')
			.addTextArea(text => {
				text.setPlaceholder('project: work\ntype: meeting\nstatus: active');
				// Convert object to text format for display
				const propsText = Object.entries(this.plugin.settings.customProperties)
					.map(([key, value]) => `${key}: ${value}`)
					.join('\n');
				text.setValue(propsText);
				text.onChange(async (value) => {
					// Parse text into object
					const properties = {};
					const lines = value.split('\n')
						.map(line => line.trim())
						.filter(line => line.length > 0);
					
					for (const line of lines) {
						const colonIndex = line.indexOf(':');
						if (colonIndex > 0) {
							const key = line.substring(0, colonIndex).trim();
							const val = line.substring(colonIndex + 1).trim();
							if (key && val) {
								properties[key] = val;
							}
						}
					}
					
					this.plugin.settings.customProperties = properties;
					await this.plugin.saveSettings();
				});
			});

		// Create a heading for daily note integration
		containerEl.createEl('h3', {text: 'Daily note integration'});

		new obsidian.Setting(containerEl)
			.setName('Daily note integration')
			.setDesc('Add todays meetings to your daily note')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.enableDailyNoteIntegration);
				toggle.onChange(async (value) => {
					this.plugin.settings.enableDailyNoteIntegration = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Daily note section name')
			.setDesc('The heading name for the Granola meetings section in your daily note')
			.addText(text => {
				text.setPlaceholder('## Granola Meetings');
				text.setValue(this.plugin.settings.dailyNoteSectionName);
				text.onChange(async (value) => {
					this.plugin.settings.dailyNoteSectionName = value;
					await this.plugin.saveSettings();
				});
			});

		// Create a heading for periodic note integration
		containerEl.createEl('h3', {text: 'Periodic note integration'});

		new obsidian.Setting(containerEl)
			.setName('Periodic note integration')
			.setDesc('Add todays meetings to your periodic notes (daily, weekly, or monthly - requires Periodic Notes plugin)')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.enablePeriodicNoteIntegration);
				toggle.setDisabled(!this.plugin.isPeriodicNotesPluginAvailable());
				toggle.onChange(async (value) => {
					this.plugin.settings.enablePeriodicNoteIntegration = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Periodic note section name')
			.setDesc('The heading name for the Granola meetings section in your periodic notes (works with daily, weekly, or monthly notes)')
			.addText(text => {
				text.setPlaceholder('## Granola Meetings');
				text.setValue(this.plugin.settings.periodicNoteSectionName);
				text.onChange(async (value) => {
					this.plugin.settings.periodicNoteSectionName = value;
					await this.plugin.saveSettings();
				});
			});

		// Create a heading for file organization settings
		containerEl.createEl('h3', {text: 'File organization'});

		new obsidian.Setting(containerEl)
			.setName('Sync directory')
			.setDesc('Directory within your vault where Granola notes will be synced')
			.addText(text => {
				text.setPlaceholder('Granola');
				text.setValue(this.plugin.settings.syncDirectory);
				text.onChange(async (value) => {
					this.plugin.settings.syncDirectory = value;
					await this.plugin.saveSettings();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Manual sync')
			.setDesc('Click to manually sync your Granola notes')
			.addButton(button => {
				button.setButtonText('Sync now');
				button.setCta();
				button.onClick(async () => {
					await this.plugin.syncNotes();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Find duplicate notes')
			.setDesc('Find and list notes with the same granola-id (helpful after changing search scope settings)')
			.addButton(button => {
				button.setButtonText('Find duplicates');
				button.onClick(async () => {
					await this.plugin.findDuplicateNotes();
				});
			});

		new obsidian.Setting(containerEl)
			.setName('Re-enable auto-sync')
			.setDesc('Re-enable auto-sync after testing new search scope settings (this will restart the auto-sync timer)')
			.addButton(button => {
				button.setButtonText('Re-enable auto-sync');
				button.onClick(async () => {
					await this.plugin.saveSettings(); // This will call setupAutoSync()
					new obsidian.Notice('Auto-sync re-enabled with current settings');
				});
			});
	}
}

module.exports = GranolaSyncPlugin;

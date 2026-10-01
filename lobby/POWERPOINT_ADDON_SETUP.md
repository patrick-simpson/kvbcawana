# Awana PowerPoint Add-in Setup Guide

This PowerPoint Add-in auto-advances your presentation and shows check-in overlays when people join.

## Quick Start

### 1. Start the Add-in Server

Run this command in the project directory:

```bash
npm run dev
```

The add-in files will be served at `http://localhost:3000/powerpoint-addon/`

### 2. Install the Add-in in PowerPoint (Windows)

#### Option A: Using PowerPoint's Add-ins Menu

1. Open PowerPoint on Windows
2. Go to **Insert** → **Get Add-ins** → **My Add-ins** → **Upload My Add-in**
3. Click **Browse** and select the file: `public/powerpoint-addon/manifest.xml`
4. Click **Upload**
5. PowerPoint will install the add-in (you may see a security prompt)

#### Option B: Using Registry (Advanced)

If Option A doesn't work, you can add the manifest location to Windows Registry:

1. Open **Registry Editor** (Win+R, type `regedit`)
2. Navigate to: `HKEY_CURRENT_USER\Software\Microsoft\Office\16.0\User Catalogs\{EBF1D0C4-8403-4C18-8FF3-71B50D44FE53}`
3. Right-click and create a new **String Value**
4. Name: anything (e.g., "AwanaAddin")
5. Value: `http://localhost:3000/powerpoint-addon/manifest.xml`
6. Restart PowerPoint

### 3. Use the Add-in

1. Open any PowerPoint presentation
2. Go to **Insert** → **Get Add-ins** → **My Add-ins** (or the Home tab)
3. Click on **Awana Check-in Slideshow**
4. A task pane will appear on the right
5. Enter your **Pusher App Key** and **Cluster**
6. Click **Start Presentation**
7. The presentation will begin, auto-advancing every 5 seconds
8. Check-in overlays will appear as people check in via the web app

## Features

- ✅ **Auto-advance slides** (configurable duration)
- ✅ **Real-time check-in overlays** via Pusher
- ✅ **Manual slide controls** (Prev/Next buttons)
- ✅ **Birthday & First-timer detection** (special animations)
- ✅ **Pusher integration** (same channel as web app)

## Configuration

### Pusher Credentials

Get your Pusher App Key and Cluster from [pusher.com](https://pusher.com):

1. Create a free Pusher Channels account
2. Create an app
3. Copy the **App Key** and **Cluster** (e.g., us2, eu, ap1)
4. Enter these in the task pane when starting the presentation

### Slide Duration

Change how long each slide displays before auto-advancing (1-120 seconds).

## Troubleshooting

### Add-in won't load

- Make sure `npm run dev` is running
- Check that the manifest path is correct
- Try restarting PowerPoint
- Check browser console (F12) for errors

### Slides not advancing

- Verify Pusher Key/Cluster are correct
- Make sure the presentation has multiple slides
- Check that the add-in status shows "connected"

### Check-in overlays not appearing

- Verify Pusher credentials are working
- Check web app is connecting to same channel
- Look for errors in PowerPoint task pane status

### Still having issues?

Check the browser console in PowerPoint:
1. Press **F12** to open DevTools
2. Go to the **Console** tab
3. Look for error messages

## Notes

- The add-in works on **Windows PowerPoint** (Office 2016+, Office 365, PowerPoint Online)
- Mac support requires different installation (contact support)
- The presentation must have timing configured in Pusher/web app
- HTTPS is recommended for production use (currently localhost only)

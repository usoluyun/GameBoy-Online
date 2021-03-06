/* 
 * JavaScript GameBoy Color Emulator
 * Copyright (C) 2010 - 2011 Grant Galitz
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * version 2 as published by the Free Software Foundation.
 * The full license is available at http://www.gnu.org/licenses/gpl.html
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 */
 /**
 *TODO:
	- Working On Right Now:
		- Make I/O bit reading and writing more accurate.
	- Started already, but far from merging into here:
		- Serial port link for multiplayer type stuff
			- Returns default and triggers serial interrupts when requested for now.
		- IR port
			- Returns default for now.
		- GBA (ARM7TDMI CPU Core) support will be coming:
			- Coming as a separate project called IodineGBA.
	- Afterwards....
		- Fix some boogs.
		- A Bit Later... Byte Later... Which ever comes first :P
			- Add some more MBC support (I haven't seen any game except one so far that uses an unsupported MBC)
				- MBC7, TAMA5, HuC1, etc.
 **/
function GameBoyCore(canvas, canvasAlt, ROMImage) {
	//Params, etc...
	this.canvas = canvas;						//Canvas DOM object for drawing out the graphics to.
	this.canvasAlt = canvasAlt;					//Image DOM object for drawing out the graphics to as an alternate means.
	this.canvasFallbackHappened = false;		//Used for external scripts to tell if we're really using the canvas or not (Helpful with fullscreen switching).
	this.drawContext = null;					// LCD Context
	this.ROMImage = ROMImage;					//The game's ROM. 
	//CPU Registers and Flags:
	this.registerA = 0x01; 						//Register A (Accumulator)
	this.FZero = true; 							//Register F  - Result was zero
	this.FSubtract = false;						//Register F  - Subtraction was executed
	this.FHalfCarry = true;						//Register F  - Half carry or half borrow
	this.FCarry = true;							//Register F  - Carry or borrow
	this.registerB = 0x00;						//Register B
	this.registerC = 0x13;						//Register C
	this.registerD = 0x00;						//Register D
	this.registerE = 0xD8;						//Register E
	this.registersHL = 0x014D;					//Registers H and L combined
	this.stackPointer = 0xFFFE;					//Stack Pointer
	this.programCounter = 0x0100;				//Program Counter
	//Some CPU Emulation State Variables:
	this.inBootstrap = true;					//Whether we're in the GBC boot ROM.
	this.usedBootROM = false;					//Updated upon ROM loading...
	this.halt = false;							//Has the CPU been suspended until the next interrupt?
	this.skipPCIncrement = false;				//Did we trip the DMG Halt bug?
	this.stopEmulator = 3;						//Has the emulation been paused or a frame has ended?
	this.IME = true;							//Are interrupts enabled?
	this.interruptsRequested = 0;				//IF Register
	this.interruptsEnabled = 0;					//IE Register
	this.hdmaRunning = false;					//HDMA Transfer Flag - GBC only
	this.CPUTicks = 0;							//The number of clock cycles emulated.
	this.multiplier = 1;						//GBC Speed Multiplier
	this.JoyPad = 0xFF;							//Joypad State (two four-bit states actually)
	//Main RAM, MBC RAM, GBC Main RAM, VRAM, etc.
	this.memoryReader = [];						//Array of functions mapped to read back memory
	this.memoryWriter = [];						//Array of functions mapped to write to memory
	this.ROM = [];								//The full ROM file dumped to an array.
	this.memory = [];							//Main Core Memory
	this.MBCRam = [];							//Switchable RAM (Used by games for more RAM) for the main memory range 0xA000 - 0xC000.
	this.VRAM = [];								//Extra VRAM bank for GBC.
	this.GBCMemory = [];						//GBC main RAM Banks
	this.MBC1Mode = false;						//MBC1 Type (4/32, 16/8)
	this.MBCRAMBanksEnabled = false;			//MBC RAM Access Control.
	this.currMBCRAMBank = 0;					//MBC Currently Indexed RAM Bank
	this.currMBCRAMBankPosition = -0xA000;		//MBC Position Adder;
	this.cGBC = false;							//GameBoy Color detection.
	this.gbcRamBank = 1;						//Currently Switched GameBoy Color ram bank
	this.gbcRamBankPosition = -0xD000;			//GBC RAM offset from address start.
	this.gbcRamBankPositionECHO = -0xF000;		//GBC RAM (ECHO mirroring) offset from address start.
	this.RAMBanks = [0, 1, 2, 4, 16];			//Used to map the RAM banks to maximum size the MBC used can do.
	this.ROMBank1offs = 0;						//Offset of the ROM bank switching.
	this.currentROMBank = 0;					//The parsed current ROM bank selection.
	this.cartridgeType = 0;						//Cartridge Type
	this.name = "";								//Name of the game
	this.gameCode = "";							//Game code (Suffix for older games)
	this.fromSaveState = false;					//A boolean to see if this was loaded in as a save state.
	this.savedStateFileName = "";				//When loaded in as a save state, this will not be empty.
	this.STATTracker = 0;						//Tracker for STAT triggering.
	this.modeSTAT = 0;							//The scan line mode (for lines 1-144 it's 2-3-0, for 145-154 it's 1)
	this.spriteCount = 63;						//Mode 3 extra clocking counter (Depends on how many sprites are on the current line.).
	this.LYCMatchTriggerSTAT = false;			//Should we trigger an interrupt if LY==LYC?
	this.mode2TriggerSTAT = false;				//Should we trigger an interrupt if in mode 2?
	this.mode1TriggerSTAT = false;				//Should we trigger an interrupt if in mode 1?
	this.mode0TriggerSTAT = false;				//Should we trigger an interrupt if in mode 0?
	this.LCDisOn = false;						//Is the emulated LCD controller on?
	this.LINECONTROL = new Array(154);			//Array of functions to handle each scan line we do (onscreen + offscreen)
	this.DISPLAYOFFCONTROL = new Array(function (parentObj) {
		//Array of line 0 function to handle the LCD controller when it's off (Do nothing!).
	});
	this.LCDCONTROL = null;						//Pointer to either LINECONTROL or DISPLAYOFFCONTROL.
	//RTC (Real Time Clock for MBC3):
	this.RTCisLatched = false;
	this.latchedSeconds = 0;					//RTC latched seconds.
	this.latchedMinutes = 0;					//RTC latched minutes.
	this.latchedHours = 0;						//RTC latched hours.
	this.latchedLDays = 0;						//RTC latched lower 8-bits of the day counter.
	this.latchedHDays = 0;						//RTC latched high-bit of the day counter.
	this.RTCSeconds = 0;						//RTC seconds counter.
	this.RTCMinutes = 0;						//RTC minutes counter.
	this.RTCHours = 0;							//RTC hours counter.
	this.RTCDays = 0;							//RTC days counter.
	this.RTCDayOverFlow = false;				//Did the RTC overflow and wrap the day counter?
	this.RTCHALT = false;						//Is the RTC allowed to clock up?
	//Gyro:
	this.highX = 127;
	this.lowX = 127;
	this.highY = 127;
	this.lowY = 127;
	//Sound variables:
	this.audioHandle = null;					//Audio object or the WAV PCM generator wrapper
	this.outTracker = 0;						//Buffering counter for the WAVE PCM output.
	this.outTrackerLimit = 0;					//Buffering limiter for WAVE PCM output.
	this.numSamplesTotal = 0;					//Length of the sound buffers.
	this.sampleSize = 0;						//Length of the sound buffer for one channel.
	this.dutyLookup = [0.125, 0.25, 0.5, 0.75];	//Map the duty values given to ones we can work with.
	this.audioSamples = [];						//The audio buffer we're working on (When not overflowing).
	this.audioBackup = [];						//Audio overflow buffer.
	this.usingBackupAsMain = 0;					//Don't copy over the backup buffer to the main buffer on the next iteration, instead make the backup the main buffer (vice versa).
	this.currentBuffer = this.audioSamples;		//Pointer to the sample workbench.
	this.initializeAudioStartState();
	this.soundMasterEnabled = false;			//As its name implies
	this.audioType = -1;						//Track what method we're using for audio output.
	//Vin Shit:
	this.VinLeftChannelEnabled = false;			//Is the VIN left channel enabled?
	this.VinRightChannelEnabled = false;		//Is the VIN right channel enabled?
	this.VinLeftChannelMasterVolume = 1;		//Computed post-mixing volume.
	this.VinRightChannelMasterVolume = 1;		//Computed post-mixing volume.
	//Channels Enabled:
	this.leftChannel = this.ArrayPad(4, false);	//Which channels are enabled for left side stereo / mono?
	this.rightChannel = this.ArrayPad(4, false);//Which channels are enabled for right side stereo?
	//Current Samples Being Computed:
	this.currentSampleLeft = 0;
	this.currentSampleRight = 0;
	this.channel3Tracker = 0;
	//Pre-multipliers to cache some calculations:
	this.initializeTiming();
	this.samplesOut = 0;				//Premultiplier for audio samples per instruction.
	//Audio generation counters:
	this.audioOverflow = false;			//Safety boolean to check for whether we're about to overwrite our buffers.
	this.audioTicks = 0;				//Used to sample the audio system every x CPU instructions.
	this.audioIndex = 0;				//Used to keep alignment on audio generation.
	this.rollover = 0;					//Used to keep alignment on the number of samples to output (Realign from counter alias).
	//Timing Variables
	this.emulatorTicks = 0;				//Times for how many instructions to execute before ending the loop.
	this.DIVTicks = 14;					//DIV Ticks Counter (Invisible lower 8-bit)
	this.LCDTicks = 15;					//Counter for how many instructions have been executed on a scanline so far.
	this.timerTicks = 0;				//Counter for the TIMA timer.
	this.TIMAEnabled = false;			//Is TIMA enabled?
	this.TACClocker = 256;				//Timer Max Ticks
	this.IRQEnableDelay = false;				//Are the interrupts on queue to be enabled?
	var dateVar = new Date();
	this.lastIteration = dateVar.getTime();//The last time we iterated the main loop.
	dateObj = new Date();
	this.firstIteration = dateObj.getTime();
	this.iterations = 0;
	this.actualScanLine = 0;			//Actual scan line...
	this.haltPostClocks = 0;			//Post-Halt clocking:
	//ROM Cartridge Components:
	this.cMBC1 = false;					//Does the cartridge use MBC1?
	this.cMBC2 = false;					//Does the cartridge use MBC2?
	this.cMBC3 = false;					//Does the cartridge use MBC3?
	this.cMBC5 = false;					//Does the cartridge use MBC5?
	this.cMBC7 = false;					//Does the cartridge use MBC7?
	this.cSRAM = false;					//Does the cartridge use save RAM?
	this.cMMMO1 = false;				//...
	this.cRUMBLE = false;				//Does the cartridge use the RUMBLE addressing (modified MBC5)?
	this.cCamera = false;				//Is the cartridge actually a GameBoy Camera?
	this.cTAMA5 = false;				//Does the cartridge use TAMA5? (Tamagotchi Cartridge)
	this.cHuC3 = false;					//Does the cartridge use HuC3 (Hudson Soft / modified MBC3)?
	this.cHuC1 = false;					//Does the cartridge use HuC1 (Hudson Soft / modified MBC1)?
	this.cTIMER = false;				//Does the cartridge have an RTC?
	this.ROMBanks = [					// 1 Bank = 16 KBytes = 256 Kbits
		2, 4, 8, 16, 32, 64, 128, 256, 512
	];
	this.ROMBanks[0x52] = 72;
	this.ROMBanks[0x53] = 80;
	this.ROMBanks[0x54] = 96;
	this.numRAMBanks = 0;					//How many RAM banks were actually allocated?
	////Graphics Variables
	this.currVRAMBank = 0;					//Current VRAM bank for GBC.
	this.gfxWindowDisplay = false;			//Is the windows enabled?
	this.gfxSpriteShow = false;				//Are sprites enabled?
	this.gfxSpriteDouble = false;			//Are we doing 8x8 or 8x16 sprites?
	this.bgEnabled = true;					//Is the BG enabled?
	this.BGPriorityEnabled = 0x1000000;		//Can we flag the BG for priority over sprites?
	this.gfxWindowCHRBankPosition = 0;		//The current bank of the character map the window uses.
	this.gfxBackgroundCHRBankPosition = 0;	//The current bank of the character map the BG uses.
	this.gfxBackgroundBankOffset = 0x80;	//Fast mapping of the tile numbering/
	this.windowY = 0;						//Current Y offset of the window.
	this.windowX = 0;						//Current X offset of the window.
	this.drewBlank = 0;						//To prevent the repeating of drawing a blank screen.
	this.midScanlineOffset = 0;				//mid-scanline rendering offset.
	//BG Tile Pointer Caches:
	this.BGCHRBank1 = this.getTypedArray(0x800, 0, "uint8");
	this.BGCHRBank2 = this.getTypedArray(0x800, 0, "uint8");
	this.BGCHRCurrentBank = this.BGCHRBank1;
	//DMG X-Coord to OAM address lookup cache:
	this.OAMAddresses = this.ArrayPad(0x100, null);
	//Tile Data Cache:
	this.tileCache = this.generateCacheArray(0xF80);
	this.tileCacheValid = this.getTypedArray(0xF80, 0, "int8");
	//Palettes:
	this.colors = new Array(0xEFFFDE, 0xADD794, 0x529273, 0x183442);	//"Classic" GameBoy palette colors.
	this.OBJPalette = null;
	this.BGPalette = null;
	this.gbcOBJRawPalette = this.getTypedArray(0x40, 0, "uint8");
	this.gbcBGRawPalette = this.getTypedArray(0x40, 0, "uint8");
	this.gbOBJPalette = this.getTypedArray(8, 0, "int32");
	this.gbBGPalette = this.getTypedArray(4, 0, "int32");
	this.gbcOBJPalette = this.getTypedArray(0x20, 0, "int32");
	this.gbcBGPalette = this.getTypedArray(0x20, 0, "int32");
	this.gbBGColorizedPalette = this.getTypedArray(4, 0, "int32");
	this.gbOBJColorizedPalette = this.getTypedArray(8, 0, "int32");
	this.cachedBGPaletteConversion = this.getTypedArray(4, 0, "int32");
	this.cachedOBJPaletteConversion = this.getTypedArray(8, 0, "int32");
	this.BGLayerRender = null;			//Reference to the BG rendering function.
	this.WindowLayerRender = null;		//Reference to the window rendering function.
	this.SpriteLayerRender = null;		//Reference to the OAM rendering function.
	this.frameBuffer = [];				//The internal frame-buffer.
	this.scaledFrameBuffer = [];		//The post-processed frame-buffer if we do scaling.
	this.canvasBuffer = null;			//imageData handle
	this.pixelStart = 0;				//Temp variable for holding the current working framebuffer offset.
	this.tileDataCopier = this.getTypedArray(8, 0, "uint16");
	this.tileDoubleDataCopier = this.getTypedArray(0x10, 0, "uint16");
	this.frameCount = settings[12];		//Frame skip tracker
	//Variables used for scaling in JS:
	this.width = 160;
	this.height = 144;
	this.pixelCount = this.width * this.height;
	this.rgbCount = this.pixelCount * 4;
	this.widthRatio = 160 / this.width;
	this.heightRatio = 144 / this.height;
}
GameBoyCore.prototype.GBCBOOTROM = new Array(	//GBC BOOT ROM (Thanks to Costis for the binary dump that I converted to this):
	//This way of loading in the BOOT ROM reminds me of when people had to punchcard the data in. :P
	0x31, 0xfe, 0xff, 0x3e, 0x02, 0xc3, 0x7c, 0x00, 	0xd3, 0x00, 0x98, 0xa0, 0x12, 0xd3, 0x00, 0x80, 
	0x00, 0x40, 0x1e, 0x53, 0xd0, 0x00, 0x1f, 0x42, 	0x1c, 0x00, 0x14, 0x2a, 0x4d, 0x19, 0x8c, 0x7e, 
	0x00, 0x7c, 0x31, 0x6e, 0x4a, 0x45, 0x52, 0x4a, 	0x00, 0x00, 0xff, 0x53, 0x1f, 0x7c, 0xff, 0x03, 
	0x1f, 0x00, 0xff, 0x1f, 0xa7, 0x00, 0xef, 0x1b, 	0x1f, 0x00, 0xef, 0x1b, 0x00, 0x7c, 0x00, 0x00, 
	0xff, 0x03, 0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 	0x00, 0x0b, 0x03, 0x73, 0x00, 0x83, 0x00, 0x0c, 
	0x00, 0x0d, 0x00, 0x08, 0x11, 0x1f, 0x88, 0x89, 	0x00, 0x0e, 0xdc, 0xcc, 0x6e, 0xe6, 0xdd, 0xdd, 
	0xd9, 0x99, 0xbb, 0xbb, 0x67, 0x63, 0x6e, 0x0e, 	0xec, 0xcc, 0xdd, 0xdc, 0x99, 0x9f, 0xbb, 0xb9, 
	0x33, 0x3e, 0x3c, 0x42, 0xb9, 0xa5, 0xb9, 0xa5, 	0x42, 0x3c, 0x58, 0x43, 0xe0, 0x70, 0x3e, 0xfc, 
	0xe0, 0x47, 0xcd, 0x75, 0x02, 0xcd, 0x00, 0x02, 	0x26, 0xd0, 0xcd, 0x03, 0x02, 0x21, 0x00, 0xfe, 
	0x0e, 0xa0, 0xaf, 0x22, 0x0d, 0x20, 0xfc, 0x11, 	0x04, 0x01, 0x21, 0x10, 0x80, 0x4c, 0x1a, 0xe2, 
	0x0c, 0xcd, 0xc6, 0x03, 0xcd, 0xc7, 0x03, 0x13, 	0x7b, 0xfe, 0x34, 0x20, 0xf1, 0x11, 0x72, 0x00, 
	0x06, 0x08, 0x1a, 0x13, 0x22, 0x23, 0x05, 0x20, 	0xf9, 0xcd, 0xf0, 0x03, 0x3e, 0x01, 0xe0, 0x4f, 
	0x3e, 0x91, 0xe0, 0x40, 0x21, 0xb2, 0x98, 0x06, 	0x4e, 0x0e, 0x44, 0xcd, 0x91, 0x02, 0xaf, 0xe0, 
	0x4f, 0x0e, 0x80, 0x21, 0x42, 0x00, 0x06, 0x18, 	0xf2, 0x0c, 0xbe, 0x20, 0xfe, 0x23, 0x05, 0x20, 
	0xf7, 0x21, 0x34, 0x01, 0x06, 0x19, 0x78, 0x86, 	0x2c, 0x05, 0x20, 0xfb, 0x86, 0x20, 0xfe, 0xcd, 
	0x1c, 0x03, 0x18, 0x02, 0x00, 0x00, 0xcd, 0xd0, 	0x05, 0xaf, 0xe0, 0x70, 0x3e, 0x11, 0xe0, 0x50, 
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
	0x21, 0x00, 0x80, 0xaf, 0x22, 0xcb, 0x6c, 0x28, 	0xfb, 0xc9, 0x2a, 0x12, 0x13, 0x0d, 0x20, 0xfa, 
	0xc9, 0xe5, 0x21, 0x0f, 0xff, 0xcb, 0x86, 0xcb, 	0x46, 0x28, 0xfc, 0xe1, 0xc9, 0x11, 0x00, 0xff, 
	0x21, 0x03, 0xd0, 0x0e, 0x0f, 0x3e, 0x30, 0x12, 	0x3e, 0x20, 0x12, 0x1a, 0x2f, 0xa1, 0xcb, 0x37, 
	0x47, 0x3e, 0x10, 0x12, 0x1a, 0x2f, 0xa1, 0xb0, 	0x4f, 0x7e, 0xa9, 0xe6, 0xf0, 0x47, 0x2a, 0xa9, 
	0xa1, 0xb0, 0x32, 0x47, 0x79, 0x77, 0x3e, 0x30, 	0x12, 0xc9, 0x3e, 0x80, 0xe0, 0x68, 0xe0, 0x6a, 
	0x0e, 0x6b, 0x2a, 0xe2, 0x05, 0x20, 0xfb, 0x4a, 	0x09, 0x43, 0x0e, 0x69, 0x2a, 0xe2, 0x05, 0x20, 
	0xfb, 0xc9, 0xc5, 0xd5, 0xe5, 0x21, 0x00, 0xd8, 	0x06, 0x01, 0x16, 0x3f, 0x1e, 0x40, 0xcd, 0x4a, 
	0x02, 0xe1, 0xd1, 0xc1, 0xc9, 0x3e, 0x80, 0xe0, 	0x26, 0xe0, 0x11, 0x3e, 0xf3, 0xe0, 0x12, 0xe0, 
	0x25, 0x3e, 0x77, 0xe0, 0x24, 0x21, 0x30, 0xff, 	0xaf, 0x0e, 0x10, 0x22, 0x2f, 0x0d, 0x20, 0xfb, 
	0xc9, 0xcd, 0x11, 0x02, 0xcd, 0x62, 0x02, 0x79, 	0xfe, 0x38, 0x20, 0x14, 0xe5, 0xaf, 0xe0, 0x4f, 
	0x21, 0xa7, 0x99, 0x3e, 0x38, 0x22, 0x3c, 0xfe, 	0x3f, 0x20, 0xfa, 0x3e, 0x01, 0xe0, 0x4f, 0xe1, 
	0xc5, 0xe5, 0x21, 0x43, 0x01, 0xcb, 0x7e, 0xcc, 	0x89, 0x05, 0xe1, 0xc1, 0xcd, 0x11, 0x02, 0x79, 
	0xd6, 0x30, 0xd2, 0x06, 0x03, 0x79, 0xfe, 0x01, 	0xca, 0x06, 0x03, 0x7d, 0xfe, 0xd1, 0x28, 0x21, 
	0xc5, 0x06, 0x03, 0x0e, 0x01, 0x16, 0x03, 0x7e, 	0xe6, 0xf8, 0xb1, 0x22, 0x15, 0x20, 0xf8, 0x0c, 
	0x79, 0xfe, 0x06, 0x20, 0xf0, 0x11, 0x11, 0x00, 	0x19, 0x05, 0x20, 0xe7, 0x11, 0xa1, 0xff, 0x19, 
	0xc1, 0x04, 0x78, 0x1e, 0x83, 0xfe, 0x62, 0x28, 	0x06, 0x1e, 0xc1, 0xfe, 0x64, 0x20, 0x07, 0x7b, 
	0xe0, 0x13, 0x3e, 0x87, 0xe0, 0x14, 0xfa, 0x02, 	0xd0, 0xfe, 0x00, 0x28, 0x0a, 0x3d, 0xea, 0x02, 
	0xd0, 0x79, 0xfe, 0x01, 0xca, 0x91, 0x02, 0x0d, 	0xc2, 0x91, 0x02, 0xc9, 0x0e, 0x26, 0xcd, 0x4a, 
	0x03, 0xcd, 0x11, 0x02, 0xcd, 0x62, 0x02, 0x0d, 	0x20, 0xf4, 0xcd, 0x11, 0x02, 0x3e, 0x01, 0xe0, 
	0x4f, 0xcd, 0x3e, 0x03, 0xcd, 0x41, 0x03, 0xaf, 	0xe0, 0x4f, 0xcd, 0x3e, 0x03, 0xc9, 0x21, 0x08, 
	0x00, 0x11, 0x51, 0xff, 0x0e, 0x05, 0xcd, 0x0a, 	0x02, 0xc9, 0xc5, 0xd5, 0xe5, 0x21, 0x40, 0xd8, 
	0x0e, 0x20, 0x7e, 0xe6, 0x1f, 0xfe, 0x1f, 0x28, 	0x01, 0x3c, 0x57, 0x2a, 0x07, 0x07, 0x07, 0xe6, 
	0x07, 0x47, 0x3a, 0x07, 0x07, 0x07, 0xe6, 0x18, 	0xb0, 0xfe, 0x1f, 0x28, 0x01, 0x3c, 0x0f, 0x0f, 
	0x0f, 0x47, 0xe6, 0xe0, 0xb2, 0x22, 0x78, 0xe6, 	0x03, 0x5f, 0x7e, 0x0f, 0x0f, 0xe6, 0x1f, 0xfe, 
	0x1f, 0x28, 0x01, 0x3c, 0x07, 0x07, 0xb3, 0x22, 	0x0d, 0x20, 0xc7, 0xe1, 0xd1, 0xc1, 0xc9, 0x0e, 
	0x00, 0x1a, 0xe6, 0xf0, 0xcb, 0x49, 0x28, 0x02, 	0xcb, 0x37, 0x47, 0x23, 0x7e, 0xb0, 0x22, 0x1a, 
	0xe6, 0x0f, 0xcb, 0x49, 0x20, 0x02, 0xcb, 0x37, 	0x47, 0x23, 0x7e, 0xb0, 0x22, 0x13, 0xcb, 0x41, 
	0x28, 0x0d, 0xd5, 0x11, 0xf8, 0xff, 0xcb, 0x49, 	0x28, 0x03, 0x11, 0x08, 0x00, 0x19, 0xd1, 0x0c, 
	0x79, 0xfe, 0x18, 0x20, 0xcc, 0xc9, 0x47, 0xd5, 	0x16, 0x04, 0x58, 0xcb, 0x10, 0x17, 0xcb, 0x13, 
	0x17, 0x15, 0x20, 0xf6, 0xd1, 0x22, 0x23, 0x22, 	0x23, 0xc9, 0x3e, 0x19, 0xea, 0x10, 0x99, 0x21, 
	0x2f, 0x99, 0x0e, 0x0c, 0x3d, 0x28, 0x08, 0x32, 	0x0d, 0x20, 0xf9, 0x2e, 0x0f, 0x18, 0xf3, 0xc9, 
	0x3e, 0x01, 0xe0, 0x4f, 0xcd, 0x00, 0x02, 0x11, 	0x07, 0x06, 0x21, 0x80, 0x80, 0x0e, 0xc0, 0x1a, 
	0x22, 0x23, 0x22, 0x23, 0x13, 0x0d, 0x20, 0xf7, 	0x11, 0x04, 0x01, 0xcd, 0x8f, 0x03, 0x01, 0xa8, 
	0xff, 0x09, 0xcd, 0x8f, 0x03, 0x01, 0xf8, 0xff, 	0x09, 0x11, 0x72, 0x00, 0x0e, 0x08, 0x23, 0x1a, 
	0x22, 0x13, 0x0d, 0x20, 0xf9, 0x21, 0xc2, 0x98, 	0x06, 0x08, 0x3e, 0x08, 0x0e, 0x10, 0x22, 0x0d, 
	0x20, 0xfc, 0x11, 0x10, 0x00, 0x19, 0x05, 0x20, 	0xf3, 0xaf, 0xe0, 0x4f, 0x21, 0xc2, 0x98, 0x3e, 
	0x08, 0x22, 0x3c, 0xfe, 0x18, 0x20, 0x02, 0x2e, 	0xe2, 0xfe, 0x28, 0x20, 0x03, 0x21, 0x02, 0x99, 
	0xfe, 0x38, 0x20, 0xed, 0x21, 0xd8, 0x08, 0x11, 	0x40, 0xd8, 0x06, 0x08, 0x3e, 0xff, 0x12, 0x13, 
	0x12, 0x13, 0x0e, 0x02, 0xcd, 0x0a, 0x02, 0x3e, 	0x00, 0x12, 0x13, 0x12, 0x13, 0x13, 0x13, 0x05, 
	0x20, 0xea, 0xcd, 0x62, 0x02, 0x21, 0x4b, 0x01, 	0x7e, 0xfe, 0x33, 0x20, 0x0b, 0x2e, 0x44, 0x1e, 
	0x30, 0x2a, 0xbb, 0x20, 0x49, 0x1c, 0x18, 0x04, 	0x2e, 0x4b, 0x1e, 0x01, 0x2a, 0xbb, 0x20, 0x3e, 
	0x2e, 0x34, 0x01, 0x10, 0x00, 0x2a, 0x80, 0x47, 	0x0d, 0x20, 0xfa, 0xea, 0x00, 0xd0, 0x21, 0xc7, 
	0x06, 0x0e, 0x00, 0x2a, 0xb8, 0x28, 0x08, 0x0c, 	0x79, 0xfe, 0x4f, 0x20, 0xf6, 0x18, 0x1f, 0x79, 
	0xd6, 0x41, 0x38, 0x1c, 0x21, 0x16, 0x07, 0x16, 	0x00, 0x5f, 0x19, 0xfa, 0x37, 0x01, 0x57, 0x7e, 
	0xba, 0x28, 0x0d, 0x11, 0x0e, 0x00, 0x19, 0x79, 	0x83, 0x4f, 0xd6, 0x5e, 0x38, 0xed, 0x0e, 0x00, 
	0x21, 0x33, 0x07, 0x06, 0x00, 0x09, 0x7e, 0xe6, 	0x1f, 0xea, 0x08, 0xd0, 0x7e, 0xe6, 0xe0, 0x07, 
	0x07, 0x07, 0xea, 0x0b, 0xd0, 0xcd, 0xe9, 0x04, 	0xc9, 0x11, 0x91, 0x07, 0x21, 0x00, 0xd9, 0xfa, 
	0x0b, 0xd0, 0x47, 0x0e, 0x1e, 0xcb, 0x40, 0x20, 	0x02, 0x13, 0x13, 0x1a, 0x22, 0x20, 0x02, 0x1b, 
	0x1b, 0xcb, 0x48, 0x20, 0x02, 0x13, 0x13, 0x1a, 	0x22, 0x13, 0x13, 0x20, 0x02, 0x1b, 0x1b, 0xcb, 
	0x50, 0x28, 0x05, 0x1b, 0x2b, 0x1a, 0x22, 0x13, 	0x1a, 0x22, 0x13, 0x0d, 0x20, 0xd7, 0x21, 0x00, 
	0xd9, 0x11, 0x00, 0xda, 0xcd, 0x64, 0x05, 0xc9, 	0x21, 0x12, 0x00, 0xfa, 0x05, 0xd0, 0x07, 0x07, 
	0x06, 0x00, 0x4f, 0x09, 0x11, 0x40, 0xd8, 0x06, 	0x08, 0xe5, 0x0e, 0x02, 0xcd, 0x0a, 0x02, 0x13, 
	0x13, 0x13, 0x13, 0x13, 0x13, 0xe1, 0x05, 0x20, 	0xf0, 0x11, 0x42, 0xd8, 0x0e, 0x02, 0xcd, 0x0a, 
	0x02, 0x11, 0x4a, 0xd8, 0x0e, 0x02, 0xcd, 0x0a, 	0x02, 0x2b, 0x2b, 0x11, 0x44, 0xd8, 0x0e, 0x02, 
	0xcd, 0x0a, 0x02, 0xc9, 0x0e, 0x60, 0x2a, 0xe5, 	0xc5, 0x21, 0xe8, 0x07, 0x06, 0x00, 0x4f, 0x09, 
	0x0e, 0x08, 0xcd, 0x0a, 0x02, 0xc1, 0xe1, 0x0d, 	0x20, 0xec, 0xc9, 0xfa, 0x08, 0xd0, 0x11, 0x18, 
	0x00, 0x3c, 0x3d, 0x28, 0x03, 0x19, 0x20, 0xfa, 	0xc9, 0xcd, 0x1d, 0x02, 0x78, 0xe6, 0xff, 0x28, 
	0x0f, 0x21, 0xe4, 0x08, 0x06, 0x00, 0x2a, 0xb9, 	0x28, 0x08, 0x04, 0x78, 0xfe, 0x0c, 0x20, 0xf6, 
	0x18, 0x2d, 0x78, 0xea, 0x05, 0xd0, 0x3e, 0x1e, 	0xea, 0x02, 0xd0, 0x11, 0x0b, 0x00, 0x19, 0x56, 
	0x7a, 0xe6, 0x1f, 0x5f, 0x21, 0x08, 0xd0, 0x3a, 	0x22, 0x7b, 0x77, 0x7a, 0xe6, 0xe0, 0x07, 0x07, 
	0x07, 0x5f, 0x21, 0x0b, 0xd0, 0x3a, 0x22, 0x7b, 	0x77, 0xcd, 0xe9, 0x04, 0xcd, 0x28, 0x05, 0xc9, 
	0xcd, 0x11, 0x02, 0xfa, 0x43, 0x01, 0xcb, 0x7f, 	0x28, 0x04, 0xe0, 0x4c, 0x18, 0x28, 0x3e, 0x04, 
	0xe0, 0x4c, 0x3e, 0x01, 0xe0, 0x6c, 0x21, 0x00, 	0xda, 0xcd, 0x7b, 0x05, 0x06, 0x10, 0x16, 0x00, 
	0x1e, 0x08, 0xcd, 0x4a, 0x02, 0x21, 0x7a, 0x00, 	0xfa, 0x00, 0xd0, 0x47, 0x0e, 0x02, 0x2a, 0xb8, 
	0xcc, 0xda, 0x03, 0x0d, 0x20, 0xf8, 0xc9, 0x01, 	0x0f, 0x3f, 0x7e, 0xff, 0xff, 0xc0, 0x00, 0xc0, 
	0xf0, 0xf1, 0x03, 0x7c, 0xfc, 0xfe, 0xfe, 0x03, 	0x07, 0x07, 0x0f, 0xe0, 0xe0, 0xf0, 0xf0, 0x1e, 
	0x3e, 0x7e, 0xfe, 0x0f, 0x0f, 0x1f, 0x1f, 0xff, 	0xff, 0x00, 0x00, 0x01, 0x01, 0x01, 0x03, 0xff, 
	0xff, 0xe1, 0xe0, 0xc0, 0xf0, 0xf9, 0xfb, 0x1f, 	0x7f, 0xf8, 0xe0, 0xf3, 0xfd, 0x3e, 0x1e, 0xe0, 
	0xf0, 0xf9, 0x7f, 0x3e, 0x7c, 0xf8, 0xe0, 0xf8, 	0xf0, 0xf0, 0xf8, 0x00, 0x00, 0x7f, 0x7f, 0x07, 
	0x0f, 0x9f, 0xbf, 0x9e, 0x1f, 0xff, 0xff, 0x0f, 	0x1e, 0x3e, 0x3c, 0xf1, 0xfb, 0x7f, 0x7f, 0xfe, 
	0xde, 0xdf, 0x9f, 0x1f, 0x3f, 0x3e, 0x3c, 0xf8, 	0xf8, 0x00, 0x00, 0x03, 0x03, 0x07, 0x07, 0xff, 
	0xff, 0xc1, 0xc0, 0xf3, 0xe7, 0xf7, 0xf3, 0xc0, 	0xc0, 0xc0, 0xc0, 0x1f, 0x1f, 0x1e, 0x3e, 0x3f, 
	0x1f, 0x3e, 0x3e, 0x80, 0x00, 0x00, 0x00, 0x7c, 	0x1f, 0x07, 0x00, 0x0f, 0xff, 0xfe, 0x00, 0x7c, 
	0xf8, 0xf0, 0x00, 0x1f, 0x0f, 0x0f, 0x00, 0x7c, 	0xf8, 0xf8, 0x00, 0x3f, 0x3e, 0x1c, 0x00, 0x0f, 
	0x0f, 0x0f, 0x00, 0x7c, 0xff, 0xff, 0x00, 0x00, 	0xf8, 0xf8, 0x00, 0x07, 0x0f, 0x0f, 0x00, 0x81, 
	0xff, 0xff, 0x00, 0xf3, 0xe1, 0x80, 0x00, 0xe0, 	0xff, 0x7f, 0x00, 0xfc, 0xf0, 0xc0, 0x00, 0x3e, 
	0x7c, 0x7c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 	0x88, 0x16, 0x36, 0xd1, 0xdb, 0xf2, 0x3c, 0x8c, 
	0x92, 0x3d, 0x5c, 0x58, 0xc9, 0x3e, 0x70, 0x1d, 	0x59, 0x69, 0x19, 0x35, 0xa8, 0x14, 0xaa, 0x75, 
	0x95, 0x99, 0x34, 0x6f, 0x15, 0xff, 0x97, 0x4b, 	0x90, 0x17, 0x10, 0x39, 0xf7, 0xf6, 0xa2, 0x49, 
	0x4e, 0x43, 0x68, 0xe0, 0x8b, 0xf0, 0xce, 0x0c, 	0x29, 0xe8, 0xb7, 0x86, 0x9a, 0x52, 0x01, 0x9d, 
	0x71, 0x9c, 0xbd, 0x5d, 0x6d, 0x67, 0x3f, 0x6b, 	0xb3, 0x46, 0x28, 0xa5, 0xc6, 0xd3, 0x27, 0x61, 
	0x18, 0x66, 0x6a, 0xbf, 0x0d, 0xf4, 0x42, 0x45, 	0x46, 0x41, 0x41, 0x52, 0x42, 0x45, 0x4b, 0x45, 
	0x4b, 0x20, 0x52, 0x2d, 0x55, 0x52, 0x41, 0x52, 	0x20, 0x49, 0x4e, 0x41, 0x49, 0x4c, 0x49, 0x43, 
	0x45, 0x20, 0x52, 0x7c, 0x08, 0x12, 0xa3, 0xa2, 	0x07, 0x87, 0x4b, 0x20, 0x12, 0x65, 0xa8, 0x16, 
	0xa9, 0x86, 0xb1, 0x68, 0xa0, 0x87, 0x66, 0x12, 	0xa1, 0x30, 0x3c, 0x12, 0x85, 0x12, 0x64, 0x1b, 
	0x07, 0x06, 0x6f, 0x6e, 0x6e, 0xae, 0xaf, 0x6f, 	0xb2, 0xaf, 0xb2, 0xa8, 0xab, 0x6f, 0xaf, 0x86, 
	0xae, 0xa2, 0xa2, 0x12, 0xaf, 0x13, 0x12, 0xa1, 	0x6e, 0xaf, 0xaf, 0xad, 0x06, 0x4c, 0x6e, 0xaf, 
	0xaf, 0x12, 0x7c, 0xac, 0xa8, 0x6a, 0x6e, 0x13, 	0xa0, 0x2d, 0xa8, 0x2b, 0xac, 0x64, 0xac, 0x6d, 
	0x87, 0xbc, 0x60, 0xb4, 0x13, 0x72, 0x7c, 0xb5, 	0xae, 0xae, 0x7c, 0x7c, 0x65, 0xa2, 0x6c, 0x64, 
	0x85, 0x80, 0xb0, 0x40, 0x88, 0x20, 0x68, 0xde, 	0x00, 0x70, 0xde, 0x20, 0x78, 0x20, 0x20, 0x38, 
	0x20, 0xb0, 0x90, 0x20, 0xb0, 0xa0, 0xe0, 0xb0, 	0xc0, 0x98, 0xb6, 0x48, 0x80, 0xe0, 0x50, 0x1e, 
	0x1e, 0x58, 0x20, 0xb8, 0xe0, 0x88, 0xb0, 0x10, 	0x20, 0x00, 0x10, 0x20, 0xe0, 0x18, 0xe0, 0x18, 
	0x00, 0x18, 0xe0, 0x20, 0xa8, 0xe0, 0x20, 0x18, 	0xe0, 0x00, 0x20, 0x18, 0xd8, 0xc8, 0x18, 0xe0, 
	0x00, 0xe0, 0x40, 0x28, 0x28, 0x28, 0x18, 0xe0, 	0x60, 0x20, 0x18, 0xe0, 0x00, 0x00, 0x08, 0xe0, 
	0x18, 0x30, 0xd0, 0xd0, 0xd0, 0x20, 0xe0, 0xe8, 	0xff, 0x7f, 0xbf, 0x32, 0xd0, 0x00, 0x00, 0x00, 
	0x9f, 0x63, 0x79, 0x42, 0xb0, 0x15, 0xcb, 0x04, 	0xff, 0x7f, 0x31, 0x6e, 0x4a, 0x45, 0x00, 0x00, 
	0xff, 0x7f, 0xef, 0x1b, 0x00, 0x02, 0x00, 0x00, 	0xff, 0x7f, 0x1f, 0x42, 0xf2, 0x1c, 0x00, 0x00, 
	0xff, 0x7f, 0x94, 0x52, 0x4a, 0x29, 0x00, 0x00, 	0xff, 0x7f, 0xff, 0x03, 0x2f, 0x01, 0x00, 0x00, 
	0xff, 0x7f, 0xef, 0x03, 0xd6, 0x01, 0x00, 0x00, 	0xff, 0x7f, 0xb5, 0x42, 0xc8, 0x3d, 0x00, 0x00, 
	0x74, 0x7e, 0xff, 0x03, 0x80, 0x01, 0x00, 0x00, 	0xff, 0x67, 0xac, 0x77, 0x13, 0x1a, 0x6b, 0x2d, 
	0xd6, 0x7e, 0xff, 0x4b, 0x75, 0x21, 0x00, 0x00, 	0xff, 0x53, 0x5f, 0x4a, 0x52, 0x7e, 0x00, 0x00, 
	0xff, 0x4f, 0xd2, 0x7e, 0x4c, 0x3a, 0xe0, 0x1c, 	0xed, 0x03, 0xff, 0x7f, 0x5f, 0x25, 0x00, 0x00, 
	0x6a, 0x03, 0x1f, 0x02, 0xff, 0x03, 0xff, 0x7f, 	0xff, 0x7f, 0xdf, 0x01, 0x12, 0x01, 0x00, 0x00, 
	0x1f, 0x23, 0x5f, 0x03, 0xf2, 0x00, 0x09, 0x00, 	0xff, 0x7f, 0xea, 0x03, 0x1f, 0x01, 0x00, 0x00, 
	0x9f, 0x29, 0x1a, 0x00, 0x0c, 0x00, 0x00, 0x00, 	0xff, 0x7f, 0x7f, 0x02, 0x1f, 0x00, 0x00, 0x00, 
	0xff, 0x7f, 0xe0, 0x03, 0x06, 0x02, 0x20, 0x01, 	0xff, 0x7f, 0xeb, 0x7e, 0x1f, 0x00, 0x00, 0x7c, 
	0xff, 0x7f, 0xff, 0x3f, 0x00, 0x7e, 0x1f, 0x00, 	0xff, 0x7f, 0xff, 0x03, 0x1f, 0x00, 0x00, 0x00, 
	0xff, 0x03, 0x1f, 0x00, 0x0c, 0x00, 0x00, 0x00, 	0xff, 0x7f, 0x3f, 0x03, 0x93, 0x01, 0x00, 0x00, 
	0x00, 0x00, 0x00, 0x42, 0x7f, 0x03, 0xff, 0x7f, 	0xff, 0x7f, 0x8c, 0x7e, 0x00, 0x7c, 0x00, 0x00, 
	0xff, 0x7f, 0xef, 0x1b, 0x80, 0x61, 0x00, 0x00, 	0xff, 0x7f, 0x00, 0x7c, 0xe0, 0x03, 0x1f, 0x7c, 
	0x1f, 0x00, 0xff, 0x03, 0x40, 0x41, 0x42, 0x20, 	0x21, 0x22, 0x80, 0x81, 0x82, 0x10, 0x11, 0x12, 
	0x12, 0xb0, 0x79, 0xb8, 0xad, 0x16, 0x17, 0x07, 	0xba, 0x05, 0x7c, 0x13, 0x00, 0x00, 0x00, 0x00
);
GameBoyCore.prototype.ffxxDump = new Array(	//Dump of the post-BOOT I/O register state (From gambatte):
	0x0F, 0x00, 0x7C, 0xFF, 0x00, 0x00, 0x00, 0xF8, 	0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01,
	0x80, 0xBF, 0xF3, 0xFF, 0xBF, 0xFF, 0x3F, 0x00, 	0xFF, 0xBF, 0x7F, 0xFF, 0x9F, 0xFF, 0xBF, 0xFF,
	0xFF, 0x00, 0x00, 0xBF, 0x77, 0xF3, 0xF1, 0xFF, 	0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
	0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 	0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF,
	0x91, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFC, 	0x00, 0x00, 0x00, 0x00, 0xFF, 0x7E, 0xFF, 0xFE,
	0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x3E, 0xFF, 	0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
	0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 	0xC0, 0xFF, 0xC1, 0x00, 0xFE, 0xFF, 0xFF, 0xFF,
	0xF8, 0xFF, 0x00, 0x00, 0x00, 0x8F, 0x00, 0x00, 	0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
	0xCE, 0xED, 0x66, 0x66, 0xCC, 0x0D, 0x00, 0x0B, 	0x03, 0x73, 0x00, 0x83, 0x00, 0x0C, 0x00, 0x0D,
	0x00, 0x08, 0x11, 0x1F, 0x88, 0x89, 0x00, 0x0E, 	0xDC, 0xCC, 0x6E, 0xE6, 0xDD, 0xDD, 0xD9, 0x99,
	0xBB, 0xBB, 0x67, 0x63, 0x6E, 0x0E, 0xEC, 0xCC, 	0xDD, 0xDC, 0x99, 0x9F, 0xBB, 0xB9, 0x33, 0x3E,
	0x45, 0xEC, 0x52, 0xFA, 0x08, 0xB7, 0x07, 0x5D, 	0x01, 0xFD, 0xC0, 0xFF, 0x08, 0xFC, 0x00, 0xE5,
	0x0B, 0xF8, 0xC2, 0xCE, 0xF4, 0xF9, 0x0F, 0x7F, 	0x45, 0x6D, 0x3D, 0xFE, 0x46, 0x97, 0x33, 0x5E,
	0x08, 0xEF, 0xF1, 0xFF, 0x86, 0x83, 0x24, 0x74, 	0x12, 0xFC, 0x00, 0x9F, 0xB4, 0xB7, 0x06, 0xD5,
	0xD0, 0x7A, 0x00, 0x9E, 0x04, 0x5F, 0x41, 0x2F, 	0x1D, 0x77, 0x36, 0x75, 0x81, 0xAA, 0x70, 0x3A,
	0x98, 0xD1, 0x71, 0x02, 0x4D, 0x01, 0xC1, 0xFF, 	0x0D, 0x00, 0xD3, 0x05, 0xF9, 0x00, 0x0B, 0x00
);
GameBoyCore.prototype.OPCODE = new Array(
	//NOP
	//#0x00:
	function (parentObj) {
		//Do Nothing...
	},
	//LD BC, nn
	//#0x01:
	function (parentObj) {
		parentObj.registerC = parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.registerB = parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF);
		parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
	},
	//LD (BC), A
	//#0x02:
	function (parentObj) {
		parentObj.memoryWrite((parentObj.registerB << 8) | parentObj.registerC, parentObj.registerA);
	},
	//INC BC
	//#0x03:
	function (parentObj) {
		var temp_var = (((parentObj.registerB << 8) | parentObj.registerC) + 1);
		parentObj.registerB = ((temp_var >> 8) & 0xFF);
		parentObj.registerC = (temp_var & 0xFF);
	},
	//INC B
	//#0x04:
	function (parentObj) {
		parentObj.registerB = ((parentObj.registerB + 1) & 0xFF);
		parentObj.FZero = (parentObj.registerB == 0);
		parentObj.FHalfCarry = ((parentObj.registerB & 0xF) == 0);
		parentObj.FSubtract = false;
	},
	//DEC B
	//#0x05:
	function (parentObj) {
		parentObj.registerB = (parentObj.registerB - 1) & 0xFF;
		parentObj.FZero = (parentObj.registerB == 0);
		parentObj.FHalfCarry = ((parentObj.registerB & 0xF) == 0xF);
		parentObj.FSubtract = true;
	},
	//LD B, n
	//#0x06:
	function (parentObj) {
		parentObj.registerB = parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
	},
	//RLCA
	//#0x07:
	function (parentObj) {
		parentObj.FCarry = ((parentObj.registerA & 0x80) == 0x80);
		parentObj.registerA = ((parentObj.registerA << 1) & 0xFF) | (parentObj.registerA >> 7);
		parentObj.FZero = parentObj.FSubtract = parentObj.FHalfCarry = false;
	},
	//LD (nn), SP
	//#0x08:
	function (parentObj) {
		var temp_var = (parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.memoryWrite(temp_var, parentObj.stackPointer & 0xFF);
		parentObj.memoryWrite((temp_var + 1) & 0xFFFF, parentObj.stackPointer >> 8);
		parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
	},
	//ADD HL, BC
	//#0x09:
	function (parentObj) {
		var n2 = (parentObj.registerB << 8) | parentObj.registerC;
		var dirtySum = parentObj.registersHL + n2;
		parentObj.FHalfCarry = ((parentObj.registersHL & 0xFFF) + (n2 & 0xFFF) > 0xFFF);
		parentObj.FCarry = (dirtySum > 0xFFFF);
		parentObj.registersHL = (dirtySum & 0xFFFF);
		parentObj.FSubtract = false;
	},
	//LD A, (BC)
	//#0x0A:
	function (parentObj) {
		parentObj.registerA = parentObj.memoryRead((parentObj.registerB << 8) | parentObj.registerC);
	},
	//DEC BC
	//#0x0B:
	function (parentObj) {
		var temp_var = (((parentObj.registerB << 8) | parentObj.registerC) - 1) & 0xFFFF;
		parentObj.registerB = (temp_var >> 8);
		parentObj.registerC = (temp_var & 0xFF);
	},
	//INC C
	//#0x0C:
	function (parentObj) {
		parentObj.registerC = ((parentObj.registerC + 1) & 0xFF);
		parentObj.FZero = (parentObj.registerC == 0);
		parentObj.FHalfCarry = ((parentObj.registerC & 0xF) == 0);
		parentObj.FSubtract = false;
	},
	//DEC C
	//#0x0D:
	function (parentObj) {
		parentObj.registerC = (parentObj.registerC - 1) & 0xFF;
		parentObj.FZero = (parentObj.registerC == 0);
		parentObj.FHalfCarry = ((parentObj.registerC & 0xF) == 0xF);
		parentObj.FSubtract = true;
	},
	//LD C, n
	//#0x0E:
	function (parentObj) {
		parentObj.registerC = parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
	},
	//RRCA
	//#0x0F:
	function (parentObj) {
		parentObj.FCarry = ((parentObj.registerA & 1) == 1);
		parentObj.registerA = (parentObj.registerA >> 1) | ((parentObj.registerA & 1) << 7);
		parentObj.FZero = parentObj.FSubtract = parentObj.FHalfCarry = false;
	},
	//STOP
	//#0x10:
	function (parentObj) {
		if (parentObj.cGBC) {
			if ((parentObj.memory[0xFF4D] & 0x01) == 0x01) {		//Speed change requested.
				if ((parentObj.memory[0xFF4D] & 0x80) == 0x80) {	//Go back to single speed mode.
					cout("Going into single clock speed mode.", 0);
					parentObj.multiplier = 1;						//TODO: Move this into the delay done code.
					parentObj.memory[0xFF4D] &= 0x7F;				//Clear the double speed mode flag.
				}
				else {												//Go to double speed mode.
					cout("Going into double clock speed mode.", 0);
					parentObj.multiplier = 2;						//TODO: Move this into the delay done code.
					parentObj.memory[0xFF4D] |= 0x80;				//Set the double speed mode flag.
				}
				parentObj.memory[0xFF4D] &= 0xFE;					//Reset the request bit.
			}
		}
	},
	//LD DE, nn
	//#0x11:
	function (parentObj) {
		parentObj.registerE = parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.registerD = parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF);
		parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
	},
	//LD (DE), A
	//#0x12:
	function (parentObj) {
		parentObj.memoryWrite((parentObj.registerD << 8) | parentObj.registerE, parentObj.registerA);
	},
	//INC DE
	//#0x13:
	function (parentObj) {
		var temp_var = (((parentObj.registerD << 8) | parentObj.registerE) + 1);
		parentObj.registerD = ((temp_var >> 8) & 0xFF);
		parentObj.registerE = (temp_var & 0xFF);
	},
	//INC D
	//#0x14:
	function (parentObj) {
		parentObj.registerD = ((parentObj.registerD + 1) & 0xFF);
		parentObj.FZero = (parentObj.registerD == 0);
		parentObj.FHalfCarry = ((parentObj.registerD & 0xF) == 0);
		parentObj.FSubtract = false;
	},
	//DEC D
	//#0x15:
	function (parentObj) {
		parentObj.registerD = (parentObj.registerD - 1) & 0xFF;
		parentObj.FZero = (parentObj.registerD == 0);
		parentObj.FHalfCarry = ((parentObj.registerD & 0xF) == 0xF);
		parentObj.FSubtract = true;
	},
	//LD D, n
	//#0x16:
	function (parentObj) {
		parentObj.registerD = parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
	},
	//RLA
	//#0x17:
	function (parentObj) {
		var carry_flag = (parentObj.FCarry) ? 1 : 0;
		parentObj.FCarry = ((parentObj.registerA & 0x80) == 0x80);
		parentObj.registerA = ((parentObj.registerA << 1) & 0xFF) | carry_flag;
		parentObj.FZero = parentObj.FSubtract = parentObj.FHalfCarry = false;
	},
	//JR n
	//#0x18:
	function (parentObj) {
		parentObj.programCounter = (parentObj.programCounter + parentObj.usbtsb(parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter)) + 1) & 0xFFFF;
	},
	//ADD HL, DE
	//#0x19:
	function (parentObj) {
		var n2 = (parentObj.registerD << 8) | parentObj.registerE;
		var dirtySum = parentObj.registersHL + n2;
		parentObj.FHalfCarry = ((parentObj.registersHL & 0xFFF) + (n2 & 0xFFF) > 0xFFF);
		parentObj.FCarry = (dirtySum > 0xFFFF);
		parentObj.registersHL = (dirtySum & 0xFFFF);
		parentObj.FSubtract = false;
	},
	//LD A, (DE)
	//#0x1A:
	function (parentObj) {
		parentObj.registerA = parentObj.memoryRead((parentObj.registerD << 8) | parentObj.registerE);
	},
	//DEC DE
	//#0x1B:
	function (parentObj) {
		var temp_var = (((parentObj.registerD << 8) | parentObj.registerE) - 1) & 0xFFFF;
		parentObj.registerD = (temp_var >> 8);
		parentObj.registerE = (temp_var & 0xFF);
	},
	//INC E
	//#0x1C:
	function (parentObj) {
		parentObj.registerE = ((parentObj.registerE + 1) & 0xFF);
		parentObj.FZero = (parentObj.registerE == 0);
		parentObj.FHalfCarry = ((parentObj.registerE & 0xF) == 0);
		parentObj.FSubtract = false;
	},
	//DEC E
	//#0x1D:
	function (parentObj) {
		parentObj.registerE = (parentObj.registerE - 1) & 0xFF;
		parentObj.FZero = (parentObj.registerE == 0);
		parentObj.FHalfCarry = ((parentObj.registerE & 0xF) == 0xF);
		parentObj.FSubtract = true;
	},
	//LD E, n
	//#0x1E:
	function (parentObj) {
		parentObj.registerE = parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
	},
	//RRA
	//#0x1F:
	function (parentObj) {
		var carry_flag = (parentObj.FCarry) ? 0x80 : 0;
		parentObj.FCarry = ((parentObj.registerA & 1) == 1);
		parentObj.registerA = (parentObj.registerA >> 1) + carry_flag;
		parentObj.FZero = parentObj.FSubtract = parentObj.FHalfCarry = false;
	},
	//JR NZ, n
	//#0x20:
	function (parentObj) {
		if (!parentObj.FZero) {
			parentObj.programCounter = (parentObj.programCounter + parentObj.usbtsb(parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter)) + 1) & 0xFFFF;
			parentObj.CPUTicks++;
		}
		else {
			parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
		}
	},
	//LD HL, nn
	//#0x21:
	function (parentObj) {
		parentObj.registersHL = (parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
	},
	//LDI (HL), A
	//#0x22:
	function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.registerA);
		parentObj.registersHL = ((parentObj.registersHL + 1) & 0xFFFF);
	},
	//INC HL
	//#0x23:
	function (parentObj) {
		parentObj.registersHL = ((parentObj.registersHL + 1) & 0xFFFF);
	},
	//INC H
	//#0x24:
	function (parentObj) {
		var H = (((parentObj.registersHL >> 8) + 1) & 0xFF);
		parentObj.FZero = (H == 0);
		parentObj.FHalfCarry = ((H & 0xF) == 0);
		parentObj.FSubtract = false;
		parentObj.registersHL = (H << 8) | (parentObj.registersHL & 0xFF);
	},
	//DEC H
	//#0x25:
	function (parentObj) {
		var H = ((parentObj.registersHL >> 8) - 1) & 0xFF;
		parentObj.FZero = (H == 0);
		parentObj.FHalfCarry = ((H & 0xF) == 0xF);
		parentObj.FSubtract = true;
		parentObj.registersHL = (H << 8) | (parentObj.registersHL & 0xFF);
	},
	//LD H, n
	//#0x26:
	function (parentObj) {
		parentObj.registersHL = (parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter) << 8) | (parentObj.registersHL & 0xFF);
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
	},
	//DAA
	//#0x27:
	function (parentObj) {
		if (!parentObj.FSubtract) {
			if (parentObj.FCarry || parentObj.registerA > 0x99) {
				parentObj.registerA = (parentObj.registerA + 0x60) & 0xFF;
				parentObj.FCarry = true;
			}
			if (parentObj.FHalfCarry || (parentObj.registerA & 0xF) > 0x9) {
				parentObj.registerA = (parentObj.registerA + 0x06) & 0xFF;
				parentObj.FHalfCarry = false;
			}
		}
		else if (parentObj.FCarry && parentObj.FHalfCarry) {
			parentObj.registerA = ((parentObj.registerA + 0x9A) & 0xFF);
			parentObj.FHalfCarry = false;
		}
		else if (parentObj.FCarry) {
			parentObj.registerA = ((parentObj.registerA + 0xA0) & 0xFF);
		}
		else if (parentObj.FHalfCarry) {
			parentObj.registerA = ((parentObj.registerA + 0xFA) & 0xFF);
			parentObj.FHalfCarry = false;
		}
		parentObj.FZero = (parentObj.registerA == 0);
	},
	//JR Z, n
	//#0x28:
	function (parentObj) {
		if (parentObj.FZero) {
			parentObj.programCounter = (parentObj.programCounter + parentObj.usbtsb(parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter)) + 1) & 0xFFFF;
			parentObj.CPUTicks++;
		}
		else {
			parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
		}
	},
	//ADD HL, HL
	//#0x29:
	function (parentObj) {;
		parentObj.FHalfCarry = ((parentObj.registersHL & 0xFFF) > 0x7FF);
		parentObj.FCarry = (parentObj.registersHL > 0x7FFF);
		parentObj.registersHL = ((parentObj.registersHL << 1) & 0xFFFF);
		parentObj.FSubtract = false;
	},
	//LDI A, (HL)
	//#0x2A:
	function (parentObj) {
		parentObj.registerA = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		parentObj.registersHL = ((parentObj.registersHL + 1) & 0xFFFF);
	},
	//DEC HL
	//#0x2B:
	function (parentObj) {
		parentObj.registersHL = (parentObj.registersHL - 1) & 0xFFFF;
	},
	//INC L
	//#0x2C:
	function (parentObj) {
		var L = ((parentObj.registersHL + 1) & 0xFF);
		parentObj.FZero = (L == 0);
		parentObj.FHalfCarry = ((L & 0xF) == 0);
		parentObj.FSubtract = false;
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | L;
	},
	//DEC L
	//#0x2D:
	function (parentObj) {
		var L = ((parentObj.registersHL - 1) & 0xFF);
		parentObj.FZero = (L == 0);
		parentObj.FHalfCarry = ((L & 0xF) == 0xF);
		parentObj.FSubtract = true;
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | L;
	},
	//LD L, n
	//#0x2E:
	function (parentObj) {
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
	},
	//CPL
	//#0x2F:
	function (parentObj) {
		parentObj.registerA ^= 0xFF;
		parentObj.FSubtract = parentObj.FHalfCarry = true;
	},
	//JR NC, n
	//#0x30:
	function (parentObj) {
		if (!parentObj.FCarry) {
			parentObj.programCounter = (parentObj.programCounter + parentObj.usbtsb(parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter)) + 1) & 0xFFFF;
			parentObj.CPUTicks++;
		}
		else {
			parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
		}
	},
	//LD SP, nn
	//#0x31:
	function (parentObj) {
		parentObj.stackPointer = (parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
	},
	//LDD (HL), A
	//#0x32:
	function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.registerA);
		parentObj.registersHL = (parentObj.registersHL - 1) & 0xFFFF;
	},
	//INC SP
	//#0x33:
	function (parentObj) {
		parentObj.stackPointer = (parentObj.stackPointer + 1) & 0xFFFF;
	},
	//INC (HL)
	//#0x34:
	function (parentObj) {
		var temp_var = ((parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) + 1) & 0xFF);
		parentObj.FZero = (temp_var == 0);
		parentObj.FHalfCarry = ((temp_var & 0xF) == 0);
		parentObj.FSubtract = false;
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, temp_var);
	},
	//DEC (HL)
	//#0x35:
	function (parentObj) {
		var temp_var = (parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) - 1) & 0xFF;
		parentObj.FZero = (temp_var == 0);
		parentObj.FHalfCarry = ((temp_var & 0xF) == 0xF);
		parentObj.FSubtract = true;
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, temp_var);
	},
	//LD (HL), n
	//#0x36:
	function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter));
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
	},
	//SCF
	//#0x37:
	function (parentObj) {
		parentObj.FCarry = true;
		parentObj.FSubtract = parentObj.FHalfCarry = false;
	},
	//JR C, n
	//#0x38:
	function (parentObj) {
		if (parentObj.FCarry) {
			parentObj.programCounter = (parentObj.programCounter + parentObj.usbtsb(parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter)) + 1) & 0xFFFF;
			parentObj.CPUTicks++;
		}
		else {
			parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
		}
	},
	//ADD HL, SP
	//#0x39:
	function (parentObj) {
		var dirtySum = parentObj.registersHL + parentObj.stackPointer;
		parentObj.FHalfCarry = ((parentObj.registersHL & 0xFFF) + (parentObj.stackPointer & 0xFFF) > 0xFFF);
		parentObj.FCarry = (dirtySum > 0xFFFF);
		parentObj.registersHL = (dirtySum & 0xFFFF);
		parentObj.FSubtract = false;
	},
	// LDD A, (HL)
	//#0x3A:
	function (parentObj) {
		parentObj.registerA = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		parentObj.registersHL = (parentObj.registersHL - 1) & 0xFFFF;
	},
	//DEC SP
	//#0x3B:
	function (parentObj) {
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
	},
	//INC A
	//#0x3C:
	function (parentObj) {
		parentObj.registerA = ((parentObj.registerA + 1) & 0xFF);
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) == 0);
		parentObj.FSubtract = false;
	},
	//DEC A
	//#0x3D:
	function (parentObj) {
		parentObj.registerA = ((parentObj.registerA - 1) & 0xFF);
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) == 0xF);
		parentObj.FSubtract = true;
	},
	//LD A, n
	//#0x3E:
	function (parentObj) {
		parentObj.registerA = parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
	},
	//CCF
	//#0x3F:
	function (parentObj) {
		parentObj.FCarry = !parentObj.FCarry;
		parentObj.FSubtract = parentObj.FHalfCarry = false;
	},
	//LD B, B
	//#0x40:
	function (parentObj) {
		//Do nothing...
	},
	//LD B, C
	//#0x41:
	function (parentObj) {
		parentObj.registerB = parentObj.registerC;
	},
	//LD B, D
	//#0x42:
	function (parentObj) {
		parentObj.registerB = parentObj.registerD;
	},
	//LD B, E
	//#0x43:
	function (parentObj) {
		parentObj.registerB = parentObj.registerE;
	},
	//LD B, H
	//#0x44:
	function (parentObj) {
		parentObj.registerB = (parentObj.registersHL >> 8);
	},
	//LD B, L
	//#0x45:
	function (parentObj) {
		parentObj.registerB = (parentObj.registersHL & 0xFF);
	},
	//LD B, (HL)
	//#0x46:
	function (parentObj) {
		parentObj.registerB = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
	},
	//LD B, A
	//#0x47:
	function (parentObj) {
		parentObj.registerB = parentObj.registerA;
	},
	//LD C, B
	//#0x48:
	function (parentObj) {
		parentObj.registerC = parentObj.registerB;
	},
	//LD C, C
	//#0x49:
	function (parentObj) {
		//Do nothing...
	},
	//LD C, D
	//#0x4A:
	function (parentObj) {
		parentObj.registerC = parentObj.registerD;
	},
	//LD C, E
	//#0x4B:
	function (parentObj) {
		parentObj.registerC = parentObj.registerE;
	},
	//LD C, H
	//#0x4C:
	function (parentObj) {
		parentObj.registerC = (parentObj.registersHL >> 8);
	},
	//LD C, L
	//#0x4D:
	function (parentObj) {
		parentObj.registerC = (parentObj.registersHL & 0xFF);
	},
	//LD C, (HL)
	//#0x4E:
	function (parentObj) {
		parentObj.registerC = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
	},
	//LD C, A
	//#0x4F:
	function (parentObj) {
		parentObj.registerC = parentObj.registerA;
	},
	//LD D, B
	//#0x50:
	function (parentObj) {
		parentObj.registerD = parentObj.registerB;
	},
	//LD D, C
	//#0x51:
	function (parentObj) {
		parentObj.registerD = parentObj.registerC;
	},
	//LD D, D
	//#0x52:
	function (parentObj) {
		//Do nothing...
	},
	//LD D, E
	//#0x53:
	function (parentObj) {
		parentObj.registerD = parentObj.registerE;
	},
	//LD D, H
	//#0x54:
	function (parentObj) {
		parentObj.registerD = (parentObj.registersHL >> 8);
	},
	//LD D, L
	//#0x55:
	function (parentObj) {
		parentObj.registerD = (parentObj.registersHL & 0xFF);
	},
	//LD D, (HL)
	//#0x56:
	function (parentObj) {
		parentObj.registerD = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
	},
	//LD D, A
	//#0x57:
	function (parentObj) {
		parentObj.registerD = parentObj.registerA;
	},
	//LD E, B
	//#0x58:
	function (parentObj) {
		parentObj.registerE = parentObj.registerB;
	},
	//LD E, C
	//#0x59:
	function (parentObj) {
		parentObj.registerE = parentObj.registerC;
	},
	//LD E, D
	//#0x5A:
	function (parentObj) {
		parentObj.registerE = parentObj.registerD;
	},
	//LD E, E
	//#0x5B:
	function (parentObj) {
		//Do nothing...
	},
	//LD E, H
	//#0x5C:
	function (parentObj) {
		parentObj.registerE = (parentObj.registersHL >> 8);
	},
	//LD E, L
	//#0x5D:
	function (parentObj) {
		parentObj.registerE = (parentObj.registersHL & 0xFF);
	},
	//LD E, (HL)
	//#0x5E:
	function (parentObj) {
		parentObj.registerE = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
	},
	//LD E, A
	//#0x5F:
	function (parentObj) {
		parentObj.registerE = parentObj.registerA;
	},
	//LD H, B
	//#0x60:
	function (parentObj) {
		parentObj.registersHL = (parentObj.registerB << 8) | (parentObj.registersHL & 0xFF);
	},
	//LD H, C
	//#0x61:
	function (parentObj) {
		parentObj.registersHL = (parentObj.registerC << 8) | (parentObj.registersHL & 0xFF);
	},
	//LD H, D
	//#0x62:
	function (parentObj) {
		parentObj.registersHL = (parentObj.registerD << 8) | (parentObj.registersHL & 0xFF);
	},
	//LD H, E
	//#0x63:
	function (parentObj) {
		parentObj.registersHL = (parentObj.registerE << 8) | (parentObj.registersHL & 0xFF);
	},
	//LD H, H
	//#0x64:
	function (parentObj) {
		//Do nothing...
	},
	//LD H, L
	//#0x65:
	function (parentObj) {
		parentObj.registersHL = (parentObj.registersHL & 0xFF) * 0x101;
	},
	//LD H, (HL)
	//#0x66:
	function (parentObj) {
		parentObj.registersHL = (parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) << 8) | (parentObj.registersHL & 0xFF);
	},
	//LD H, A
	//#0x67:
	function (parentObj) {
		parentObj.registersHL = (parentObj.registerA << 8) | (parentObj.registersHL & 0xFF);
	},
	//LD L, B
	//#0x68:
	function (parentObj) {
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | parentObj.registerB;
	},
	//LD L, C
	//#0x69:
	function (parentObj) {
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | parentObj.registerC;
	},
	//LD L, D
	//#0x6A:
	function (parentObj) {
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | parentObj.registerD;
	},
	//LD L, E
	//#0x6B:
	function (parentObj) {
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | parentObj.registerE;
	},
	//LD L, H
	//#0x6C:
	function (parentObj) {
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | (parentObj.registersHL >> 8);
	},
	//LD L, L
	//#0x6D:
	function (parentObj) {
		//Do nothing...
	},
	//LD L, (HL)
	//#0x6E:
	function (parentObj) {
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
	},
	//LD L, A
	//#0x6F:
	function (parentObj) {
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | parentObj.registerA;
	},
	//LD (HL), B
	//#0x70:
	function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.registerB);
	},
	//LD (HL), C
	//#0x71:
	function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.registerC);
	},
	//LD (HL), D
	//#0x72:
	function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.registerD);
	},
	//LD (HL), E
	//#0x73:
	function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.registerE);
	},
	//LD (HL), H
	//#0x74:
	function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.registersHL >> 8);
	},
	//LD (HL), L
	//#0x75:
	function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.registersHL & 0xFF);
	},
	//HALT
	//#0x76:
	function (parentObj) {
		if (!parentObj.halt) {
			if (parentObj.cGBC) {
				++parentObj.CPUTicks;	//CGB adds a hidden NOP.
			}
			//See if we're taking an interrupt already:
			if ((parentObj.interruptsEnabled & parentObj.interruptsRequested & 0x1F) > 0) {
				//If an IRQ is already going to launch:
				if (!parentObj.IME) {
					if (!parentObj.cGBC && !parentObj.usedBootROM) {
						//HALT bug in the DMG CPU model (Program Counter fails to increment for one instruction after HALT):
						parentObj.skipPCIncrement = true;
						return;
					}
					//CGB gets around the HALT PC bug by doubling the hidden NOP.
					++parentObj.CPUTicks;
				}
				return;
			}
			//Make sure we minimally clock 1:
			parentObj.haltPostClocks = --parentObj.CPUTicks;
			var originalHaltClock = 1;
		}
		else {
			var originalHaltClock = 0;
		}
		//Prepare the short-circuit directly to the next IRQ event:
		var maximumClocks = (parentObj.CPUCyclesPerIteration - parentObj.emulatorTicks) * parentObj.multiplier;
		var currentClocks = maximumClocks + 1;
		if (parentObj.LCDisOn) {
			if ((parentObj.interruptsEnabled & 0x1) == 0x1) {
				currentClocks = Math.min(((114 * (((parentObj.modeSTAT == 1) ? 298 : 144) - parentObj.actualScanLine)) - parentObj.LCDTicks) * parentObj.multiplier, currentClocks);
			}
			if ((parentObj.interruptsEnabled & 0x2) == 0x2) {
				if (parentObj.mode0TriggerSTAT) {
					currentClocks = Math.min(parentObj.clocksUntilMode0(), currentClocks);
				}
				if (parentObj.mode1TriggerSTAT && (parentObj.interruptsEnabled & 0x1) == 0) {
					currentClocks = Math.min(((114 * (((parentObj.modeSTAT == 1) ? 298 : 144) - parentObj.actualScanLine)) - parentObj.LCDTicks) * parentObj.multiplier, currentClocks);
				}
				if (parentObj.mode2TriggerSTAT) {
					currentClocks = Math.min((((parentObj.actualScanLine >= 143) ? (114 * (154 - parentObj.actualScanLine)) : 114) - parentObj.LCDTicks) * parentObj.multiplier, currentClocks);
				}
				if (parentObj.LYCMatchTriggerSTAT && parentObj.memory[0xFF45] <= 153) {
					currentClocks = Math.min(parentObj.clocksUntilLYCMatch(), currentClocks);
				}
			}
		}
		if (parentObj.TIMAEnabled && (parentObj.interruptsEnabled & 0x4) == 0x4) {
			currentClocks = Math.min(((0x100 - parentObj.memory[0xFF05]) * parentObj.TACClocker) - parentObj.timerTicks, currentClocks);
		}
		if (currentClocks < (maximumClocks + 1)) {
			//Exit out of HALT normally:
			parentObj.CPUTicks = Math.max(currentClocks, originalHaltClock);
			parentObj.updateCore();
			parentObj.CPUTicks = parentObj.haltPostClocks;
			parentObj.halt = false;
		}
		else {
			//We have to bail out of HALT since the clocking is so large:
			parentObj.CPUTicks = maximumClocks;
			parentObj.halt = true;	//Flags that we will jump back to HALT on the next iteration.
		}
	},
	//LD (HL), A
	//#0x77:
	function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.registerA);
	},
	//LD A, B
	//#0x78:
	function (parentObj) {
		parentObj.registerA = parentObj.registerB;
	},
	//LD A, C
	//#0x79:
	function (parentObj) {
		parentObj.registerA = parentObj.registerC;
	},
	//LD A, D
	//#0x7A:
	function (parentObj) {
		parentObj.registerA = parentObj.registerD;
	},
	//LD A, E
	//#0x7B:
	function (parentObj) {
		parentObj.registerA = parentObj.registerE;
	},
	//LD A, H
	//#0x7C:
	function (parentObj) {
		parentObj.registerA = (parentObj.registersHL >> 8);
	},
	//LD A, L
	//#0x7D:
	function (parentObj) {
		parentObj.registerA = (parentObj.registersHL & 0xFF);
	},
	//LD, A, (HL)
	//#0x7E:
	function (parentObj) {
		parentObj.registerA = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
	},
	//LD A, A
	//#0x7F:
	function (parentObj) {
		//Do Nothing...
	},
	//ADD A, B
	//#0x80:
	function (parentObj) {
		var dirtySum = parentObj.registerA + parentObj.registerB;
		parentObj.FHalfCarry = (dirtySum & 0xF) < (parentObj.registerA & 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
	},
	//ADD A, C
	//#0x81:
	function (parentObj) {
		var dirtySum = parentObj.registerA + parentObj.registerC;
		parentObj.FHalfCarry = (dirtySum & 0xF) < (parentObj.registerA & 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
	},
	//ADD A, D
	//#0x82:
	function (parentObj) {
		var dirtySum = parentObj.registerA + parentObj.registerD;
		parentObj.FHalfCarry = (dirtySum & 0xF) < (parentObj.registerA & 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
	},
	//ADD A, E
	//#0x83:
	function (parentObj) {
		var dirtySum = parentObj.registerA + parentObj.registerE;
		parentObj.FHalfCarry = (dirtySum & 0xF) < (parentObj.registerA & 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
	},
	//ADD A, H
	//#0x84:
	function (parentObj) {
		var dirtySum = parentObj.registerA + (parentObj.registersHL >> 8);
		parentObj.FHalfCarry = (dirtySum & 0xF) < (parentObj.registerA & 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
	},
	//ADD A, L
	//#0x85:
	function (parentObj) {
		var dirtySum = parentObj.registerA + (parentObj.registersHL & 0xFF);
		parentObj.FHalfCarry = (dirtySum & 0xF) < (parentObj.registerA & 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
	},
	//ADD A, (HL)
	//#0x86:
	function (parentObj) {
		var dirtySum = parentObj.registerA + parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		parentObj.FHalfCarry = (dirtySum & 0xF) < (parentObj.registerA & 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
	},
	//ADD A, A
	//#0x87:
	function (parentObj) {
		parentObj.FHalfCarry = ((parentObj.registerA & 0x8) == 0x8);
		parentObj.FCarry = (parentObj.registerA > 0x7F);
		parentObj.registerA = (parentObj.registerA << 1) & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
	},
	//ADC A, B
	//#0x88:
	function (parentObj) {
		var dirtySum = parentObj.registerA + parentObj.registerB + ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) + (parentObj.registerB & 0xF) + ((parentObj.FCarry) ? 1 : 0) > 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
	},
	//ADC A, C
	//#0x89:
	function (parentObj) {
		var dirtySum = parentObj.registerA + parentObj.registerC + ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) + (parentObj.registerC & 0xF) + ((parentObj.FCarry) ? 1 : 0) > 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
	},
	//ADC A, D
	//#0x8A:
	function (parentObj) {
		var dirtySum = parentObj.registerA + parentObj.registerD + ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) + (parentObj.registerD & 0xF) + ((parentObj.FCarry) ? 1 : 0) > 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
	},
	//ADC A, E
	//#0x8B:
	function (parentObj) {
		var dirtySum = parentObj.registerA + parentObj.registerE + ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) + (parentObj.registerE & 0xF) + ((parentObj.FCarry) ? 1 : 0) > 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
	},
	//ADC A, H
	//#0x8C:
	function (parentObj) {
		var tempValue = (parentObj.registersHL >> 8);
		var dirtySum = parentObj.registerA + tempValue + ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) + (tempValue & 0xF) + ((parentObj.FCarry) ? 1 : 0) > 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
	},
	//ADC A, L
	//#0x8D:
	function (parentObj) {
		var tempValue = (parentObj.registersHL & 0xFF);
		var dirtySum = parentObj.registerA + tempValue + ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) + (tempValue & 0xF) + ((parentObj.FCarry) ? 1 : 0) > 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
	},
	//ADC A, (HL)
	//#0x8E:
	function (parentObj) {
		var tempValue = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		var dirtySum = parentObj.registerA + tempValue + ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) + (tempValue & 0xF) + ((parentObj.FCarry) ? 1 : 0) > 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
	},
	//ADC A, A
	//#0x8F:
	function (parentObj) {
		//shift left register A one bit for some ops here as an optimization:
		var dirtySum = (parentObj.registerA << 1) | ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((((parentObj.registerA << 1) & 0x1E) | ((parentObj.FCarry) ? 1 : 0)) > 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
	},
	//SUB A, B
	//#0x90:
	function (parentObj) {
		var dirtySum = parentObj.registerA - parentObj.registerB;
		parentObj.FHalfCarry = (parentObj.registerA & 0xF) < (parentObj.registerB & 0xF);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = true;
	},
	//SUB A, C
	//#0x91:
	function (parentObj) {
		var dirtySum = parentObj.registerA - parentObj.registerC;
		parentObj.FHalfCarry = (parentObj.registerA & 0xF) < (parentObj.registerC & 0xF);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = true;
	},
	//SUB A, D
	//#0x92:
	function (parentObj) {
		var dirtySum = parentObj.registerA - parentObj.registerD;
		parentObj.FHalfCarry = (parentObj.registerA & 0xF) < (parentObj.registerD & 0xF);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = true;
	},
	//SUB A, E
	//#0x93:
	function (parentObj) {
		var dirtySum = parentObj.registerA - parentObj.registerE;
		parentObj.FHalfCarry = (parentObj.registerA & 0xF) < (parentObj.registerE & 0xF);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = true;
	},
	//SUB A, H
	//#0x94:
	function (parentObj) {
		var temp_var = parentObj.registersHL >> 8;
		var dirtySum = parentObj.registerA - temp_var;
		parentObj.FHalfCarry = (parentObj.registerA & 0xF) < (temp_var & 0xF);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = true;
	},
	//SUB A, L
	//#0x95:
	function (parentObj) {
		var dirtySum = parentObj.registerA - (parentObj.registersHL & 0xFF);
		parentObj.FHalfCarry = (parentObj.registerA & 0xF) < (parentObj.registersHL & 0xF);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = true;
	},
	//SUB A, (HL)
	//#0x96:
	function (parentObj) {
		var temp_var = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		var dirtySum = parentObj.registerA - temp_var;
		parentObj.FHalfCarry = (parentObj.registerA & 0xF) < (temp_var & 0xF);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = true;
	},
	//SUB A, A
	//#0x97:
	function (parentObj) {
		//number - same number == 0
		parentObj.registerA = 0;
		parentObj.FHalfCarry = parentObj.FCarry = false;
		parentObj.FZero = parentObj.FSubtract = true;
	},
	//SBC A, B
	//#0x98:
	function (parentObj) {
		var dirtySum = parentObj.registerA - parentObj.registerB - ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) - (parentObj.registerB & 0xF) - ((parentObj.FCarry) ? 1 : 0) < 0);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = true;
	},
	//SBC A, C
	//#0x99:
	function (parentObj) {
		var dirtySum = parentObj.registerA - parentObj.registerC - ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) - (parentObj.registerC & 0xF) - ((parentObj.FCarry) ? 1 : 0) < 0);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = true;
	},
	//SBC A, D
	//#0x9A:
	function (parentObj) {
		var dirtySum = parentObj.registerA - parentObj.registerD - ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) - (parentObj.registerD & 0xF) - ((parentObj.FCarry) ? 1 : 0) < 0);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = true;
	},
	//SBC A, E
	//#0x9B:
	function (parentObj) {
		var dirtySum = parentObj.registerA - parentObj.registerE - ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) - (parentObj.registerE & 0xF) - ((parentObj.FCarry) ? 1 : 0) < 0);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = true;
	},
	//SBC A, H
	//#0x9C:
	function (parentObj) {
		var temp_var = parentObj.registersHL >> 8;
		var dirtySum = parentObj.registerA - temp_var - ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) - (temp_var & 0xF) - ((parentObj.FCarry) ? 1 : 0) < 0);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = true;
	},
	//SBC A, L
	//#0x9D:
	function (parentObj) {
		var dirtySum = parentObj.registerA - (parentObj.registersHL & 0xFF) - ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) - (parentObj.registersHL & 0xF) - ((parentObj.FCarry) ? 1 : 0) < 0);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = true;
	},
	//SBC A, (HL)
	//#0x9E:
	function (parentObj) {
		var temp_var = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		var dirtySum = parentObj.registerA - temp_var - ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) - (temp_var & 0xF) - ((parentObj.FCarry) ? 1 : 0) < 0);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = true;
	},
	//SBC A, A
	//#0x9F:
	function (parentObj) {
		//Optimized SBC A:
		if (parentObj.FCarry) {
			parentObj.FZero = false;
			parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = true;
			parentObj.registerA = 0xFF;
		}
		else {
			parentObj.FHalfCarry = parentObj.FCarry = false;
			parentObj.FSubtract = parentObj.FZero = true;
			parentObj.registerA = 0;
		}
	},
	//AND B
	//#0xA0:
	function (parentObj) {
		parentObj.registerA &= parentObj.registerB;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = parentObj.FCarry = false;
	},
	//AND C
	//#0xA1:
	function (parentObj) {
		parentObj.registerA &= parentObj.registerC;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = parentObj.FCarry = false;
	},
	//AND D
	//#0xA2:
	function (parentObj) {
		parentObj.registerA &= parentObj.registerD;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = parentObj.FCarry = false;
	},
	//AND E
	//#0xA3:
	function (parentObj) {
		parentObj.registerA &= parentObj.registerE;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = parentObj.FCarry = false;
	},
	//AND H
	//#0xA4:
	function (parentObj) {
		parentObj.registerA &= (parentObj.registersHL >> 8);
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = parentObj.FCarry = false;
	},
	//AND L
	//#0xA5:
	function (parentObj) {
		parentObj.registerA &= parentObj.registersHL;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = parentObj.FCarry = false;
	},
	//AND (HL)
	//#0xA6:
	function (parentObj) {
		parentObj.registerA &= parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = parentObj.FCarry = false;
	},
	//AND A
	//#0xA7:
	function (parentObj) {
		//number & same number = same number
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = parentObj.FCarry = false;
	},
	//XOR B
	//#0xA8:
	function (parentObj) {
		parentObj.registerA ^= parentObj.registerB;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
	},
	//XOR C
	//#0xA9:
	function (parentObj) {
		parentObj.registerA ^= parentObj.registerC;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
	},
	//XOR D
	//#0xAA:
	function (parentObj) {
		parentObj.registerA ^= parentObj.registerD;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
	},
	//XOR E
	//#0xAB:
	function (parentObj) {
		parentObj.registerA ^= parentObj.registerE;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
	},
	//XOR H
	//#0xAC:
	function (parentObj) {
		parentObj.registerA ^= (parentObj.registersHL >> 8);
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
	},
	//XOR L
	//#0xAD:
	function (parentObj) {
		parentObj.registerA ^= (parentObj.registersHL & 0xFF);
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
	},
	//XOR (HL)
	//#0xAE:
	function (parentObj) {
		parentObj.registerA ^= parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
	},
	//XOR A
	//#0xAF:
	function (parentObj) {
		//number ^ same number == 0
		parentObj.registerA = 0;
		parentObj.FZero = true;
		parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
	},
	//OR B
	//#0xB0:
	function (parentObj) {
		parentObj.registerA |= parentObj.registerB;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
	},
	//OR C
	//#0xB1:
	function (parentObj) {
		parentObj.registerA |= parentObj.registerC;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
	},
	//OR D
	//#0xB2:
	function (parentObj) {
		parentObj.registerA |= parentObj.registerD;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
	},
	//OR E
	//#0xB3:
	function (parentObj) {
		parentObj.registerA |= parentObj.registerE;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
	},
	//OR H
	//#0xB4:
	function (parentObj) {
		parentObj.registerA |= (parentObj.registersHL >> 8);
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
	},
	//OR L
	//#0xB5:
	function (parentObj) {
		parentObj.registerA |= (parentObj.registersHL & 0xFF);
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
	},
	//OR (HL)
	//#0xB6:
	function (parentObj) {
		parentObj.registerA |= parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
	},
	//OR A
	//#0xB7:
	function (parentObj) {
		//number | same number == same number
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
	},
	//CP B
	//#0xB8:
	function (parentObj) {
		var dirtySum = parentObj.registerA - parentObj.registerB;
		parentObj.FHalfCarry = (dirtySum & 0xF) > (parentObj.registerA & 0xF);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.FZero = (dirtySum == 0);
		parentObj.FSubtract = true;
	},
	//CP C
	//#0xB9:
	function (parentObj) {
		var dirtySum = parentObj.registerA - parentObj.registerC;
		parentObj.FHalfCarry = (dirtySum & 0xF) > (parentObj.registerA & 0xF);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.FZero = (dirtySum == 0);
		parentObj.FSubtract = true;
	},
	//CP D
	//#0xBA:
	function (parentObj) {
		var dirtySum = parentObj.registerA - parentObj.registerD;
		parentObj.FHalfCarry = (dirtySum & 0xF) > (parentObj.registerA & 0xF);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.FZero = (dirtySum == 0);
		parentObj.FSubtract = true;
	},
	//CP E
	//#0xBB:
	function (parentObj) {
		var dirtySum = parentObj.registerA - parentObj.registerE;
		parentObj.FHalfCarry = (dirtySum & 0xF) > (parentObj.registerA & 0xF);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.FZero = (dirtySum == 0);
		parentObj.FSubtract = true;
	},
	//CP H
	//#0xBC:
	function (parentObj) {
		var dirtySum = parentObj.registerA - (parentObj.registersHL >> 8);
		parentObj.FHalfCarry = (dirtySum & 0xF) > (parentObj.registerA & 0xF);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.FZero = (dirtySum == 0);
		parentObj.FSubtract = true;
	},
	//CP L
	//#0xBD:
	function (parentObj) {
		var dirtySum = parentObj.registerA - (parentObj.registersHL & 0xFF);
		parentObj.FHalfCarry = (dirtySum & 0xF) > (parentObj.registerA & 0xF);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.FZero = (dirtySum == 0);
		parentObj.FSubtract = true;
	},
	//CP (HL)
	//#0xBE:
	function (parentObj) {
		var dirtySum = parentObj.registerA - parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		parentObj.FHalfCarry = (dirtySum & 0xF) > (parentObj.registerA & 0xF);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.FZero = (dirtySum == 0);
		parentObj.FSubtract = true;
	},
	//CP A
	//#0xBF:
	function (parentObj) {
		parentObj.FHalfCarry = parentObj.FCarry = false;
		parentObj.FZero = parentObj.FSubtract = true;
	},
	//RET !FZ
	//#0xC0:
	function (parentObj) {
		if (!parentObj.FZero) {
			parentObj.programCounter = (parentObj.memoryRead((parentObj.stackPointer + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.stackPointer](parentObj, parentObj.stackPointer);
			parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xFFFF;
			parentObj.CPUTicks += 3;
		}
	},
	//POP BC
	//#0xC1:
	function (parentObj) {
		parentObj.registerC = parentObj.memoryReader[parentObj.stackPointer](parentObj, parentObj.stackPointer);
		parentObj.registerB = parentObj.memoryRead((parentObj.stackPointer + 1) & 0xFFFF);
		parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xFFFF;
	},
	//JP !FZ, nn
	//#0xC2:
	function (parentObj) {
		if (!parentObj.FZero) {
			parentObj.programCounter = (parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
			parentObj.CPUTicks++;
		}
		else {
			parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
		}
	},
	//JP nn
	//#0xC3:
	function (parentObj) {
		parentObj.programCounter = (parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
	},
	//CALL !FZ, nn
	//#0xC4:
	function (parentObj) {
		if (!parentObj.FZero) {
			var temp_pc = (parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
			parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
			parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
			parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter >> 8);
			parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
			parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter & 0xFF);
			parentObj.programCounter = temp_pc;
			parentObj.CPUTicks += 3;
		}
		else {
			parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
		}
	},
	//PUSH BC
	//#0xC5:
	function (parentObj) {
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.registerB);
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.registerC);
	},
	//ADD, n
	//#0xC6:
	function (parentObj) {
		var dirtySum = parentObj.registerA + parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.FHalfCarry = (dirtySum & 0xF) < (parentObj.registerA & 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
	},
	//RST 0
	//#0xC7:
	function (parentObj) {
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter >> 8);
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter & 0xFF);
		parentObj.programCounter = 0;
	},
	//RET FZ
	//#0xC8:
	function (parentObj) {
		if (parentObj.FZero) {
			parentObj.programCounter = (parentObj.memoryRead((parentObj.stackPointer + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.stackPointer](parentObj, parentObj.stackPointer);
			parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xFFFF;
			parentObj.CPUTicks += 3;
		}
	},
	//RET
	//#0xC9:
	function (parentObj) {
		parentObj.programCounter =  (parentObj.memoryRead((parentObj.stackPointer + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.stackPointer](parentObj, parentObj.stackPointer);
		parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xFFFF;
	},
	//JP FZ, nn
	//#0xCA:
	function (parentObj) {
		if (parentObj.FZero) {
			parentObj.programCounter = (parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
			parentObj.CPUTicks++;
		}
		else {
			parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
		}
	},
	//Secondary OP Code Set:
	//#0xCB:
	function (parentObj) {
		var opcode = parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		//Increment the program counter to the next instruction:
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
		//Get how many CPU cycles the current 0xCBXX op code counts for:
		parentObj.CPUTicks = parentObj.SecondaryTICKTable[opcode];
		//Execute secondary OP codes for the 0xCB OP code call.
		parentObj.CBOPCODE[opcode](parentObj);
	},
	//CALL FZ, nn
	//#0xCC:
	function (parentObj) {
		if (parentObj.FZero) {
			var temp_pc = (parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
			parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
			parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
			parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter >> 8);
			parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
			parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter & 0xFF);
			parentObj.programCounter = temp_pc;
			parentObj.CPUTicks += 3;
		}
		else {
			parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
		}
	},
	//CALL nn
	//#0xCD:
	function (parentObj) {
		var temp_pc = (parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter >> 8);
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter & 0xFF);
		parentObj.programCounter = temp_pc;
	},
	//ADC A, n
	//#0xCE:
	function (parentObj) {
		var tempValue = parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		var dirtySum = parentObj.registerA + tempValue + ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) + (tempValue & 0xF) + ((parentObj.FCarry) ? 1 : 0) > 0xF);
		parentObj.FCarry = (dirtySum > 0xFF);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = false;
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
	},
	//RST 0x8
	//#0xCF:
	function (parentObj) {
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter >> 8);
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter & 0xFF);
		parentObj.programCounter = 0x8;
	},
	//RET !FC
	//#0xD0:
	function (parentObj) {
		if (!parentObj.FCarry) {
			parentObj.programCounter = (parentObj.memoryRead((parentObj.stackPointer + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.stackPointer](parentObj, parentObj.stackPointer);
			parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xFFFF;
			parentObj.CPUTicks += 3;
		}
	},
	//POP DE
	//#0xD1:
	function (parentObj) {
		parentObj.registerE = parentObj.memoryReader[parentObj.stackPointer](parentObj, parentObj.stackPointer);
		parentObj.registerD = parentObj.memoryRead((parentObj.stackPointer + 1) & 0xFFFF);
		parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xFFFF;
	},
	//JP !FC, nn
	//#0xD2:
	function (parentObj) {
		if (!parentObj.FCarry) {
			parentObj.programCounter = (parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
			parentObj.CPUTicks++;
		}
		else {
			parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
		}
	},
	//0xD3 - Illegal
	//#0xD3:
	function (parentObj) {
		cout("Illegal op code 0xD3 called, pausing emulation.", 2);
		pause();
	},
	//CALL !FC, nn
	//#0xD4:
	function (parentObj) {
		if (!parentObj.FCarry) {
			var temp_pc = (parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
			parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
			parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
			parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter >> 8);
			parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
			parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter & 0xFF);
			parentObj.programCounter = temp_pc;
			parentObj.CPUTicks += 3;
		}
		else {
			parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
		}
	},
	//PUSH DE
	//#0xD5:
	function (parentObj) {
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.registerD);
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.registerE);
	},
	//SUB A, n
	//#0xD6:
	function (parentObj) {
		var temp_var = parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		var dirtySum = parentObj.registerA - temp_var;
		parentObj.FHalfCarry = (parentObj.registerA & 0xF) < (temp_var & 0xF);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = true;
	},
	//RST 0x10
	//#0xD7:
	function (parentObj) {
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter >> 8);
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter & 0xFF);
		parentObj.programCounter = 0x10;
	},
	//RET FC
	//#0xD8:
	function (parentObj) {
		if (parentObj.FCarry) {
			parentObj.programCounter = (parentObj.memoryRead((parentObj.stackPointer + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.stackPointer](parentObj, parentObj.stackPointer);
			parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xFFFF;
			parentObj.CPUTicks += 3;
		}
	},
	//RETI
	//#0xD9:
	function (parentObj) {
		parentObj.programCounter = (parentObj.memoryRead((parentObj.stackPointer + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.stackPointer](parentObj, parentObj.stackPointer);
		parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xFFFF;
		if (parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter) == 0x76) {
			//Immediate for HALT:
			parentObj.IME = true;
			parentObj.IRQEnableDelay = false;
		}
		else {
			parentObj.IRQEnableDelay = true;
		}
	},
	//JP FC, nn
	//#0xDA:
	function (parentObj) {
		if (parentObj.FCarry) {
			parentObj.programCounter = (parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
			parentObj.CPUTicks++;
		}
		else {
			parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
		}
	},
	//0xDB - Illegal
	//#0xDB:
	function (parentObj) {
		cout("Illegal op code 0xDB called, pausing emulation.", 2);
		pause();
	},
	//CALL FC, nn
	//#0xDC:
	function (parentObj) {
		if (parentObj.FCarry) {
			var temp_pc = (parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
			parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
			parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
			parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter >> 8);
			parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
			parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter & 0xFF);
			parentObj.programCounter = temp_pc;
			parentObj.CPUTicks += 3;
		}
		else {
			parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
		}
	},
	//0xDD - Illegal
	//#0xDD:
	function (parentObj) {
		cout("Illegal op code 0xDD called, pausing emulation.", 2);
		pause();
	},
	//SBC A, n
	//#0xDE:
	function (parentObj) {
		var temp_var = parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		var dirtySum = parentObj.registerA - temp_var - ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = ((parentObj.registerA & 0xF) - (temp_var & 0xF) - ((parentObj.FCarry) ? 1 : 0) < 0);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.registerA = dirtySum & 0xFF;
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FSubtract = true;
	},
	//RST 0x18
	//#0xDF:
	function (parentObj) {
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter >> 8);
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter & 0xFF);
		parentObj.programCounter = 0x18;
	},
	//LDH (n), A
	//#0xE0:
	function (parentObj) {
		parentObj.memoryWrite(0xFF00 | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter), parentObj.registerA);
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
	},
	//POP HL
	//#0xE1:
	function (parentObj) {
		parentObj.registersHL = (parentObj.memoryRead((parentObj.stackPointer + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.stackPointer](parentObj, parentObj.stackPointer);
		parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xFFFF;
	},
	//LD (0xFF00 + C), A
	//#0xE2:
	function (parentObj) {
		parentObj.memoryWrite(0xFF00 | parentObj.registerC, parentObj.registerA);
	},
	//0xE3 - Illegal
	//#0xE3:
	function (parentObj) {
		cout("Illegal op code 0xE3 called, pausing emulation.", 2);
		pause();
	},
	//0xE4 - Illegal
	//#0xE4:
	function (parentObj) {
		cout("Illegal op code 0xE4 called, pausing emulation.", 2);
		pause();
	},
	//PUSH HL
	//#0xE5:
	function (parentObj) {
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.registersHL >> 8);
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.registersHL & 0xFF);
	},
	//AND n
	//#0xE6:
	function (parentObj) {
		parentObj.registerA &= parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = parentObj.FCarry = false;
	},
	//RST 0x20
	//#0xE7:
	function (parentObj) {
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter >> 8);
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter & 0xFF);
		parentObj.programCounter = 0x20;
	},
	//ADD SP, n
	//#0xE8:
	function (parentObj) {
		var signedByte = parentObj.usbtsb(parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter));
		var temp_value = (parentObj.stackPointer + signedByte) & 0xFFFF;
		parentObj.FCarry = (((parentObj.stackPointer ^ signedByte ^ temp_value) & 0x100) == 0x100);
		parentObj.FHalfCarry = (((parentObj.stackPointer ^ signedByte ^ temp_value) & 0x10) == 0x10);
		parentObj.stackPointer = temp_value;
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
		parentObj.FZero = parentObj.FSubtract = false;
	},
	//JP, (HL)
	//#0xE9:
	function (parentObj) {
		parentObj.programCounter = parentObj.registersHL;
	},
	//LD n, A
	//#0xEA:
	function (parentObj) {
		parentObj.memoryWrite((parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter), parentObj.registerA);
		parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
	},
	//0xEB - Illegal
	//#0xEB:
	function (parentObj) {
		cout("Illegal op code 0xEB called, pausing emulation.", 2);
		pause();
	},
	//0xEC - Illegal
	//#0xEC:
	function (parentObj) {
		cout("Illegal op code 0xEC called, pausing emulation.", 2);
		pause();
	},
	//0xED - Illegal
	//#0xED:
	function (parentObj) {
		cout("Illegal op code 0xED called, pausing emulation.", 2);
		pause();
	},
	//XOR n
	//#0xEE:
	function (parentObj) {
		parentObj.registerA ^= parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
		parentObj.FSubtract = parentObj.FHalfCarry = parentObj.FCarry = false;
	},
	//RST 0x28
	//#0xEF:
	function (parentObj) {
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter >> 8);
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter & 0xFF);
		parentObj.programCounter = 0x28;
	},
	//LDH A, (n)
	//#0xF0:
	function (parentObj) {
		parentObj.registerA = parentObj.memoryRead(0xFF00 | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter));
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
	},
	//POP AF
	//#0xF1:
	function (parentObj) {
		var temp_var = parentObj.memoryReader[parentObj.stackPointer](parentObj, parentObj.stackPointer);
		parentObj.FZero = ((temp_var & 0x80) == 0x80);
		parentObj.FSubtract = ((temp_var & 0x40) == 0x40);
		parentObj.FHalfCarry = ((temp_var & 0x20) == 0x20);
		parentObj.FCarry = ((temp_var & 0x10) == 0x10);
		parentObj.registerA = parentObj.memoryRead((parentObj.stackPointer + 1) & 0xFFFF);
		parentObj.stackPointer = (parentObj.stackPointer + 2) & 0xFFFF;
	},
	//LD A, (0xFF00 + C)
	//#0xF2:
	function (parentObj) {
		parentObj.registerA = parentObj.memoryRead(0xFF00 | parentObj.registerC);
	},
	//DI
	//#0xF3:
	function (parentObj) {
		parentObj.IME = false;
		parentObj.IRQEnableDelay = false;
	},
	//0xF4 - Illegal
	//#0xF4:
	function (parentObj) {
		cout("Illegal op code 0xF4 called, pausing emulation.", 2);
		pause();
	},
	//PUSH AF
	//#0xF5:
	function (parentObj) {
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.registerA);
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, ((parentObj.FZero) ? 0x80 : 0) | ((parentObj.FSubtract) ? 0x40 : 0) | ((parentObj.FHalfCarry) ? 0x20 : 0) | ((parentObj.FCarry) ? 0x10 : 0));
	},
	//OR n
	//#0xF6:
	function (parentObj) {
		parentObj.registerA |= parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
		parentObj.FSubtract = parentObj.FCarry = parentObj.FHalfCarry = false;
	},
	//RST 0x30
	//#0xF7:
	function (parentObj) {
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter >> 8);
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter & 0xFF);
		parentObj.programCounter = 0x30;
	},
	//LDHL SP, n
	//#0xF8:
	function (parentObj) {
		var signedByte = parentObj.usbtsb(parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter));
		parentObj.registersHL = (parentObj.stackPointer + signedByte) & 0xFFFF;
		parentObj.FCarry = (((parentObj.stackPointer ^ signedByte ^ parentObj.registersHL) & 0x100) == 0x100);
		parentObj.FHalfCarry = (((parentObj.stackPointer ^ signedByte ^ parentObj.registersHL) & 0x10) == 0x10);
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
		parentObj.FZero = parentObj.FSubtract = false;
	},
	//LD SP, HL
	//#0xF9:
	function (parentObj) {
		parentObj.stackPointer = parentObj.registersHL;
	},
	//LD A, (nn)
	//#0xFA:
	function (parentObj) {
		parentObj.registerA = parentObj.memoryRead((parentObj.memoryRead((parentObj.programCounter + 1) & 0xFFFF) << 8) | parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter));
		parentObj.programCounter = (parentObj.programCounter + 2) & 0xFFFF;
	},
	//EI
	//#0xFB:
	function (parentObj) {
		if (parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter) == 0x76) {
			//Immediate for HALT:
			parentObj.IME = true;
			parentObj.IRQEnableDelay = false;
		}
		else {
			parentObj.IRQEnableDelay = true;
		}
	},
	//0xFC - Illegal
	//#0xFC:
	function (parentObj) {
		cout("Illegal op code 0xFC called, pausing emulation.", 2);
		pause();
	},
	//0xFD - Illegal
	//#0xFD:
	function (parentObj) {
		cout("Illegal op code 0xFD called, pausing emulation.", 2);
		pause();
	},
	//CP n
	//#0xFE:
	function (parentObj) {
		var dirtySum = parentObj.registerA - parentObj.memoryReader[parentObj.programCounter](parentObj, parentObj.programCounter);
		parentObj.FHalfCarry = (dirtySum & 0xF) > (parentObj.registerA & 0xF);
		parentObj.FCarry = (dirtySum < 0);
		parentObj.FZero = (dirtySum == 0);
		parentObj.programCounter = (parentObj.programCounter + 1) & 0xFFFF;
		parentObj.FSubtract = true;
	},
	//RST 0x38
	//#0xFF:
	function (parentObj) {
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter >> 8);
		parentObj.stackPointer = (parentObj.stackPointer - 1) & 0xFFFF;
		parentObj.memoryWriter[parentObj.stackPointer](parentObj, parentObj.stackPointer, parentObj.programCounter & 0xFF);
		parentObj.programCounter = 0x38;
	}
);
GameBoyCore.prototype.CBOPCODE = new Array(
	//#0x00:
	function (parentObj) {
		parentObj.FCarry = ((parentObj.registerB & 0x80) == 0x80);
		parentObj.registerB = ((parentObj.registerB << 1) & 0xFF) | ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerB == 0);
	}
	//#0x01:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerC & 0x80) == 0x80);
		parentObj.registerC = ((parentObj.registerC << 1) & 0xFF) | ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerC == 0);
	}
	//#0x02:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerD & 0x80) == 0x80);
		parentObj.registerD = ((parentObj.registerD << 1) & 0xFF) | ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerD == 0);
	}
	//#0x03:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerE & 0x80) == 0x80);
		parentObj.registerE = ((parentObj.registerE << 1) & 0xFF) | ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerE == 0);
	}
	//#0x04:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registersHL & 0x8000) == 0x8000);
		parentObj.registersHL = ((parentObj.registersHL << 1) & 0xFE00) | ((parentObj.FCarry) ? 0x100 : 0) | (parentObj.registersHL & 0xFF);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registersHL <= 0xFF);
	}
	//#0x05:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registersHL & 0x80) == 0x80);
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | ((parentObj.registersHL << 1) & 0xFF) | ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0xFF) == 0x00);
	}
	//#0x06:
	,function (parentObj) {
		var temp_var = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		parentObj.FCarry = ((temp_var & 0x80) == 0x80);
		temp_var = ((temp_var << 1) & 0xFF) | ((parentObj.FCarry) ? 1 : 0);
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, temp_var);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (temp_var == 0x00);
	}
	//#0x07:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerA & 0x80) == 0x80);
		parentObj.registerA = ((parentObj.registerA << 1) & 0xFF) | ((parentObj.FCarry) ? 1 : 0);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerA == 0x00);
	}
	//#0x08:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerB & 0x01) == 0x01);
		parentObj.registerB = ((parentObj.FCarry) ? 0x80 : 0) | (parentObj.registerB >> 1);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerB == 0);
	}
	//#0x09:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerC & 0x01) == 0x01);
		parentObj.registerC = ((parentObj.FCarry) ? 0x80 : 0) | (parentObj.registerC >> 1);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerC == 0);
	}
	//#0x0A:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerD & 0x01) == 0x01);
		parentObj.registerD = ((parentObj.FCarry) ? 0x80 : 0) | (parentObj.registerD >> 1);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerD == 0);
	}
	//#0x0B:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerE & 0x01) == 0x01);
		parentObj.registerE = ((parentObj.FCarry) ? 0x80 : 0) | (parentObj.registerE >> 1);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerE == 0);
	}
	//#0x0C:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registersHL & 0x0100) == 0x0100);
		parentObj.registersHL = ((parentObj.FCarry) ? 0x8000 : 0) | ((parentObj.registersHL >> 1) & 0xFF00) | (parentObj.registersHL & 0xFF);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registersHL <= 0xFF);
	}
	//#0x0D:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registersHL & 0x01) == 0x01);
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | ((parentObj.FCarry) ? 0x80 : 0) | ((parentObj.registersHL & 0xFF) >> 1);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0xFF) == 0x00);
	}
	//#0x0E:
	,function (parentObj) {
		var temp_var = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		parentObj.FCarry = ((temp_var & 0x01) == 0x01);
		temp_var = ((parentObj.FCarry) ? 0x80 : 0) | (temp_var >> 1);
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, temp_var);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (temp_var == 0x00);
	}
	//#0x0F:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerA & 0x01) == 0x01);
		parentObj.registerA = ((parentObj.FCarry) ? 0x80 : 0) | (parentObj.registerA >> 1);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerA == 0x00);
	}
	//#0x10:
	,function (parentObj) {
		var newFCarry = ((parentObj.registerB & 0x80) == 0x80);
		parentObj.registerB = ((parentObj.registerB << 1) & 0xFF) | ((parentObj.FCarry) ? 1 : 0);
		parentObj.FCarry = newFCarry;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerB == 0);
	}
	//#0x11:
	,function (parentObj) {
		var newFCarry = ((parentObj.registerC & 0x80) == 0x80);
		parentObj.registerC = ((parentObj.registerC << 1) & 0xFF) | ((parentObj.FCarry) ? 1 : 0);
		parentObj.FCarry = newFCarry;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerC == 0);
	}
	//#0x12:
	,function (parentObj) {
		var newFCarry = ((parentObj.registerD & 0x80) == 0x80);
		parentObj.registerD = ((parentObj.registerD << 1) & 0xFF) | ((parentObj.FCarry) ? 1 : 0);
		parentObj.FCarry = newFCarry;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerD == 0);
	}
	//#0x13:
	,function (parentObj) {
		var newFCarry = ((parentObj.registerE & 0x80) == 0x80);
		parentObj.registerE = ((parentObj.registerE << 1) & 0xFF) | ((parentObj.FCarry) ? 1 : 0);
		parentObj.FCarry = newFCarry;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerE == 0);
	}
	//#0x14:
	,function (parentObj) {
		var newFCarry = ((parentObj.registersHL & 0x8000) == 0x8000);
		parentObj.registersHL = ((parentObj.registersHL << 1) & 0xFE00) | ((parentObj.FCarry) ? 0x100 : 0) | (parentObj.registersHL & 0xFF);
		parentObj.FCarry = newFCarry;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registersHL <= 0xFF);
	}
	//#0x15:
	,function (parentObj) {
		var newFCarry = ((parentObj.registersHL & 0x80) == 0x80);
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | ((parentObj.registersHL << 1) & 0xFF) | ((parentObj.FCarry) ? 1 : 0);
		parentObj.FCarry = newFCarry;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0xFF) == 0x00);
	}
	//#0x16:
	,function (parentObj) {
		var temp_var = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		var newFCarry = ((temp_var & 0x80) == 0x80);
		temp_var = ((temp_var << 1) & 0xFF) | ((parentObj.FCarry) ? 1 : 0);
		parentObj.FCarry = newFCarry;
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, temp_var);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (temp_var == 0x00);
	}
	//#0x17:
	,function (parentObj) {
		var newFCarry = ((parentObj.registerA & 0x80) == 0x80);
		parentObj.registerA = ((parentObj.registerA << 1) & 0xFF) | ((parentObj.FCarry) ? 1 : 0);
		parentObj.FCarry = newFCarry;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerA == 0x00);
	}
	//#0x18:
	,function (parentObj) {
		var newFCarry = ((parentObj.registerB & 0x01) == 0x01);
		parentObj.registerB = ((parentObj.FCarry) ? 0x80 : 0) | (parentObj.registerB >> 1);
		parentObj.FCarry = newFCarry;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerB == 0);
	}
	//#0x19:
	,function (parentObj) {
		var newFCarry = ((parentObj.registerC & 0x01) == 0x01);
		parentObj.registerC = ((parentObj.FCarry) ? 0x80 : 0) | (parentObj.registerC >> 1);
		parentObj.FCarry = newFCarry;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerC == 0);
	}
	//#0x1A:
	,function (parentObj) {
		var newFCarry = ((parentObj.registerD & 0x01) == 0x01);
		parentObj.registerD = ((parentObj.FCarry) ? 0x80 : 0) | (parentObj.registerD >> 1);
		parentObj.FCarry = newFCarry;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerD == 0);
	}
	//#0x1B:
	,function (parentObj) {
		var newFCarry = ((parentObj.registerE & 0x01) == 0x01);
		parentObj.registerE = ((parentObj.FCarry) ? 0x80 : 0) | (parentObj.registerE >> 1);
		parentObj.FCarry = newFCarry;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerE == 0);
	}
	//#0x1C:
	,function (parentObj) {
		var newFCarry = ((parentObj.registersHL & 0x0100) == 0x0100);
		parentObj.registersHL = ((parentObj.FCarry) ? 0x8000 : 0) | ((parentObj.registersHL >> 1) & 0xFF00) | (parentObj.registersHL & 0xFF);
		parentObj.FCarry = newFCarry;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registersHL <= 0xFF);
	}
	//#0x1D:
	,function (parentObj) {
		var newFCarry = ((parentObj.registersHL & 0x01) == 0x01);
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | ((parentObj.FCarry) ? 0x80 : 0) | ((parentObj.registersHL & 0xFF) >> 1);
		parentObj.FCarry = newFCarry;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0xFF) == 0x00);
	}
	//#0x1E:
	,function (parentObj) {
		var temp_var = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		var newFCarry = ((temp_var & 0x01) == 0x01);
		temp_var = ((parentObj.FCarry) ? 0x80 : 0) | (temp_var >> 1);
		parentObj.FCarry = newFCarry;
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, temp_var);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (temp_var == 0x00);
	}
	//#0x1F:
	,function (parentObj) {
		var newFCarry = ((parentObj.registerA & 0x01) == 0x01);
		parentObj.registerA = ((parentObj.FCarry) ? 0x80 : 0) | (parentObj.registerA >> 1);
		parentObj.FCarry = newFCarry;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerA == 0x00);
	}
	//#0x20:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerB & 0x80) == 0x80);
		parentObj.registerB = (parentObj.registerB << 1) & 0xFF;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerB == 0);
	}
	//#0x21:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerC & 0x80) == 0x80);
		parentObj.registerC = (parentObj.registerC << 1) & 0xFF;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerC == 0);
	}
	//#0x22:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerD & 0x80) == 0x80);
		parentObj.registerD = (parentObj.registerD << 1) & 0xFF;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerD == 0);
	}
	//#0x23:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerE & 0x80) == 0x80);
		parentObj.registerE = (parentObj.registerE << 1) & 0xFF;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerE == 0);
	}
	//#0x24:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registersHL & 0x8000) == 0x8000);
		parentObj.registersHL = ((parentObj.registersHL << 1) & 0xFE00) | (parentObj.registersHL & 0xFF);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registersHL <= 0xFF);
	}
	//#0x25:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registersHL & 0x0080) == 0x0080);
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | ((parentObj.registersHL << 1) & 0xFF);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0xFF) == 0x00);
	}
	//#0x26:
	,function (parentObj) {
		var temp_var = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		parentObj.FCarry = ((temp_var & 0x80) == 0x80);
		temp_var = (temp_var << 1) & 0xFF;
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, temp_var);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (temp_var == 0x00);
	}
	//#0x27:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerA & 0x80) == 0x80);
		parentObj.registerA = (parentObj.registerA << 1) & 0xFF;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerA == 0x00);
	}
	//#0x28:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerB & 0x01) == 0x01);
		parentObj.registerB = (parentObj.registerB & 0x80) | (parentObj.registerB >> 1);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerB == 0);
	}
	//#0x29:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerC & 0x01) == 0x01);
		parentObj.registerC = (parentObj.registerC & 0x80) | (parentObj.registerC >> 1);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerC == 0);
	}
	//#0x2A:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerD & 0x01) == 0x01);
		parentObj.registerD = (parentObj.registerD & 0x80) | (parentObj.registerD >> 1);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerD == 0);
	}
	//#0x2B:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerE & 0x01) == 0x01);
		parentObj.registerE = (parentObj.registerE & 0x80) | (parentObj.registerE >> 1);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerE == 0);
	}
	//#0x2C:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registersHL & 0x0100) == 0x0100);
		parentObj.registersHL = ((parentObj.registersHL >> 1) & 0xFF00) | (parentObj.registersHL & 0x80FF);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registersHL <= 0xFF);
	}
	//#0x2D:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registersHL & 0x0001) == 0x0001);
		parentObj.registersHL = (parentObj.registersHL & 0xFF80) | ((parentObj.registersHL & 0xFF) >> 1);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0xFF) == 0x00);
	}
	//#0x2E:
	,function (parentObj) {
		var temp_var = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		parentObj.FCarry = ((temp_var & 0x01) == 0x01);
		temp_var = (temp_var & 0x80) | (temp_var >> 1);
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, temp_var);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (temp_var == 0x00);
	}
	//#0x2F:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerA & 0x01) == 0x01);
		parentObj.registerA = (parentObj.registerA & 0x80) | (parentObj.registerA >> 1);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerA == 0x00);
	}
	//#0x30:
	,function (parentObj) {
		parentObj.registerB = ((parentObj.registerB & 0xF) << 4) | (parentObj.registerB >> 4);
		parentObj.FZero = (parentObj.registerB == 0);
		parentObj.FCarry = parentObj.FHalfCarry = parentObj.FSubtract = false;
	}
	//#0x31:
	,function (parentObj) {
		parentObj.registerC = ((parentObj.registerC & 0xF) << 4) | (parentObj.registerC >> 4);
		parentObj.FZero = (parentObj.registerC == 0);
		parentObj.FCarry = parentObj.FHalfCarry = parentObj.FSubtract = false;
	}
	//#0x32:
	,function (parentObj) {
		parentObj.registerD = ((parentObj.registerD & 0xF) << 4) | (parentObj.registerD >> 4);
		parentObj.FZero = (parentObj.registerD == 0);
		parentObj.FCarry = parentObj.FHalfCarry = parentObj.FSubtract = false;
	}
	//#0x33:
	,function (parentObj) {
		parentObj.registerE = ((parentObj.registerE & 0xF) << 4) | (parentObj.registerE >> 4);
		parentObj.FZero = (parentObj.registerE == 0);
		parentObj.FCarry = parentObj.FHalfCarry = parentObj.FSubtract = false;
	}
	//#0x34:
	,function (parentObj) {
		parentObj.registersHL = ((parentObj.registersHL & 0xF00) << 4) | ((parentObj.registersHL & 0xF000) >> 4) | (parentObj.registersHL & 0xFF);
		parentObj.FZero = (parentObj.registersHL <= 0xFF);
		parentObj.FCarry = parentObj.FHalfCarry = parentObj.FSubtract = false;
	}
	//#0x35:
	,function (parentObj) {
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | ((parentObj.registersHL & 0xF) << 4) | ((parentObj.registersHL & 0xF0) >> 4);
		parentObj.FZero = ((parentObj.registersHL & 0xFF) == 0);
		parentObj.FCarry = parentObj.FHalfCarry = parentObj.FSubtract = false;
	}
	//#0x36:
	,function (parentObj) {
		var temp_var = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		temp_var = ((temp_var & 0xF) << 4) | (temp_var >> 4);
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, temp_var);
		parentObj.FZero = (temp_var == 0);
		parentObj.FCarry = parentObj.FHalfCarry = parentObj.FSubtract = false;
	}
	//#0x37:
	,function (parentObj) {
		parentObj.registerA = ((parentObj.registerA & 0xF) << 4) | (parentObj.registerA >> 4);
		parentObj.FZero = (parentObj.registerA == 0);
		parentObj.FCarry = parentObj.FHalfCarry = parentObj.FSubtract = false;
	}
	//#0x38:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerB & 0x01) == 0x01);
		parentObj.registerB >>= 1;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerB == 0);
	}
	//#0x39:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerC & 0x01) == 0x01);
		parentObj.registerC >>= 1;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerC == 0);
	}
	//#0x3A:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerD & 0x01) == 0x01);
		parentObj.registerD >>= 1;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerD == 0);
	}
	//#0x3B:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerE & 0x01) == 0x01);
		parentObj.registerE >>= 1;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerE == 0);
	}
	//#0x3C:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registersHL & 0x0100) == 0x0100);
		parentObj.registersHL = ((parentObj.registersHL >> 1) & 0xFF00) | (parentObj.registersHL & 0xFF);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registersHL <= 0xFF);
	}
	//#0x3D:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registersHL & 0x0001) == 0x0001);
		parentObj.registersHL = (parentObj.registersHL & 0xFF00) | ((parentObj.registersHL & 0xFF) >> 1);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0xFF) == 0x00);
	}
	//#0x3E:
	,function (parentObj) {
		var temp_var = parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL);
		parentObj.FCarry = ((temp_var & 0x01) == 0x01);
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, temp_var >>= 1);
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (temp_var == 0x00);
	}
	//#0x3F:
	,function (parentObj) {
		parentObj.FCarry = ((parentObj.registerA & 0x01) == 0x01);
		parentObj.registerA >>= 1;
		parentObj.FHalfCarry = parentObj.FSubtract = false;
		parentObj.FZero = (parentObj.registerA == 0x00);
	}
	//#0x40:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerB & 0x01) == 0);
	}
	//#0x41:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerC & 0x01) == 0);
	}
	//#0x42:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerD & 0x01) == 0);
	}
	//#0x43:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerE & 0x01) == 0);
	}
	//#0x44:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0x0100) == 0);
	}
	//#0x45:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0x0001) == 0);
	}
	//#0x46:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) & 0x01) == 0);
	}
	//#0x47:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerA & 0x01) == 0);
	}
	//#0x48:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerB & 0x02) == 0);
	}
	//#0x49:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerC & 0x02) == 0);
	}
	//#0x4A:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerD & 0x02) == 0);
	}
	//#0x4B:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerE & 0x02) == 0);
	}
	//#0x4C:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0x0200) == 0);
	}
	//#0x4D:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0x0002) == 0);
	}
	//#0x4E:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) & 0x02) == 0);
	}
	//#0x4F:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerA & 0x02) == 0);
	}
	//#0x50:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerB & 0x04) == 0);
	}
	//#0x51:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerC & 0x04) == 0);
	}
	//#0x52:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerD & 0x04) == 0);
	}
	//#0x53:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerE & 0x04) == 0);
	}
	//#0x54:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0x0400) == 0);
	}
	//#0x55:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0x0004) == 0);
	}
	//#0x56:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) & 0x04) == 0);
	}
	//#0x57:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerA & 0x04) == 0);
	}
	//#0x58:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerB & 0x08) == 0);
	}
	//#0x59:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerC & 0x08) == 0);
	}
	//#0x5A:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerD & 0x08) == 0);
	}
	//#0x5B:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerE & 0x08) == 0);
	}
	//#0x5C:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0x0800) == 0);
	}
	//#0x5D:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0x0008) == 0);
	}
	//#0x5E:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) & 0x08) == 0);
	}
	//#0x5F:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerA & 0x08) == 0);
	}
	//#0x60:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerB & 0x10) == 0);
	}
	//#0x61:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerC & 0x10) == 0);
	}
	//#0x62:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerD & 0x10) == 0);
	}
	//#0x63:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerE & 0x10) == 0);
	}
	//#0x64:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0x1000) == 0);
	}
	//#0x65:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0x0010) == 0);
	}
	//#0x66:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) & 0x10) == 0);
	}
	//#0x67:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerA & 0x10) == 0);
	}
	//#0x68:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerB & 0x20) == 0);
	}
	//#0x69:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerC & 0x20) == 0);
	}
	//#0x6A:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerD & 0x20) == 0);
	}
	//#0x6B:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerE & 0x20) == 0);
	}
	//#0x6C:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0x2000) == 0);
	}
	//#0x6D:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0x0020) == 0);
	}
	//#0x6E:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) & 0x20) == 0);
	}
	//#0x6F:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerA & 0x20) == 0);
	}
	//#0x70:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerB & 0x40) == 0);
	}
	//#0x71:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerC & 0x40) == 0);
	}
	//#0x72:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerD & 0x40) == 0);
	}
	//#0x73:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerE & 0x40) == 0);
	}
	//#0x74:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0x4000) == 0);
	}
	//#0x75:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0x0040) == 0);
	}
	//#0x76:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) & 0x40) == 0);
	}
	//#0x77:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerA & 0x40) == 0);
	}
	//#0x78:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerB & 0x80) == 0);
	}
	//#0x79:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerC & 0x80) == 0);
	}
	//#0x7A:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerD & 0x80) == 0);
	}
	//#0x7B:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerE & 0x80) == 0);
	}
	//#0x7C:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0x8000) == 0);
	}
	//#0x7D:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registersHL & 0x0080) == 0);
	}
	//#0x7E:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) & 0x80) == 0);
	}
	//#0x7F:
	,function (parentObj) {
		parentObj.FHalfCarry = true;
		parentObj.FSubtract = false;
		parentObj.FZero = ((parentObj.registerA & 0x80) == 0);
	}
	//#0x80:
	,function (parentObj) {
		parentObj.registerB &= 0xFE;
	}
	//#0x81:
	,function (parentObj) {
		parentObj.registerC &= 0xFE;
	}
	//#0x82:
	,function (parentObj) {
		parentObj.registerD &= 0xFE;
	}
	//#0x83:
	,function (parentObj) {
		parentObj.registerE &= 0xFE;
	}
	//#0x84:
	,function (parentObj) {
		parentObj.registersHL &= 0xFEFF;
	}
	//#0x85:
	,function (parentObj) {
		parentObj.registersHL &= 0xFFFE;
	}
	//#0x86:
	,function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) & 0xFE);
	}
	//#0x87:
	,function (parentObj) {
		parentObj.registerA &= 0xFE;
	}
	//#0x88:
	,function (parentObj) {
		parentObj.registerB &= 0xFD;
	}
	//#0x89:
	,function (parentObj) {
		parentObj.registerC &= 0xFD;
	}
	//#0x8A:
	,function (parentObj) {
		parentObj.registerD &= 0xFD;
	}
	//#0x8B:
	,function (parentObj) {
		parentObj.registerE &= 0xFD;
	}
	//#0x8C:
	,function (parentObj) {
		parentObj.registersHL &= 0xFDFF;
	}
	//#0x8D:
	,function (parentObj) {
		parentObj.registersHL &= 0xFFFD;
	}
	//#0x8E:
	,function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) & 0xFD);
	}
	//#0x8F:
	,function (parentObj) {
		parentObj.registerA &= 0xFD;
	}
	//#0x90:
	,function (parentObj) {
		parentObj.registerB &= 0xFB;
	}
	//#0x91:
	,function (parentObj) {
		parentObj.registerC &= 0xFB;
	}
	//#0x92:
	,function (parentObj) {
		parentObj.registerD &= 0xFB;
	}
	//#0x93:
	,function (parentObj) {
		parentObj.registerE &= 0xFB;
	}
	//#0x94:
	,function (parentObj) {
		parentObj.registersHL &= 0xFBFF;
	}
	//#0x95:
	,function (parentObj) {
		parentObj.registersHL &= 0xFFFB;
	}
	//#0x96:
	,function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) & 0xFB);
	}
	//#0x97:
	,function (parentObj) {
		parentObj.registerA &= 0xFB;
	}
	//#0x98:
	,function (parentObj) {
		parentObj.registerB &= 0xF7;
	}
	//#0x99:
	,function (parentObj) {
		parentObj.registerC &= 0xF7;
	}
	//#0x9A:
	,function (parentObj) {
		parentObj.registerD &= 0xF7;
	}
	//#0x9B:
	,function (parentObj) {
		parentObj.registerE &= 0xF7;
	}
	//#0x9C:
	,function (parentObj) {
		parentObj.registersHL &= 0xF7FF;
	}
	//#0x9D:
	,function (parentObj) {
		parentObj.registersHL &= 0xFFF7;
	}
	//#0x9E:
	,function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) & 0xF7);
	}
	//#0x9F:
	,function (parentObj) {
		parentObj.registerA &= 0xF7;
	}
	//#0xA0:
	,function (parentObj) {
		parentObj.registerB &= 0xEF;
	}
	//#0xA1:
	,function (parentObj) {
		parentObj.registerC &= 0xEF;
	}
	//#0xA2:
	,function (parentObj) {
		parentObj.registerD &= 0xEF;
	}
	//#0xA3:
	,function (parentObj) {
		parentObj.registerE &= 0xEF;
	}
	//#0xA4:
	,function (parentObj) {
		parentObj.registersHL &= 0xEFFF;
	}
	//#0xA5:
	,function (parentObj) {
		parentObj.registersHL &= 0xFFEF;
	}
	//#0xA6:
	,function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) & 0xEF);
	}
	//#0xA7:
	,function (parentObj) {
		parentObj.registerA &= 0xEF;
	}
	//#0xA8:
	,function (parentObj) {
		parentObj.registerB &= 0xDF;
	}
	//#0xA9:
	,function (parentObj) {
		parentObj.registerC &= 0xDF;
	}
	//#0xAA:
	,function (parentObj) {
		parentObj.registerD &= 0xDF;
	}
	//#0xAB:
	,function (parentObj) {
		parentObj.registerE &= 0xDF;
	}
	//#0xAC:
	,function (parentObj) {
		parentObj.registersHL &= 0xDFFF;
	}
	//#0xAD:
	,function (parentObj) {
		parentObj.registersHL &= 0xFFDF;
	}
	//#0xAE:
	,function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) & 0xDF);
	}
	//#0xAF:
	,function (parentObj) {
		parentObj.registerA &= 0xDF;
	}
	//#0xB0:
	,function (parentObj) {
		parentObj.registerB &= 0xBF;
	}
	//#0xB1:
	,function (parentObj) {
		parentObj.registerC &= 0xBF;
	}
	//#0xB2:
	,function (parentObj) {
		parentObj.registerD &= 0xBF;
	}
	//#0xB3:
	,function (parentObj) {
		parentObj.registerE &= 0xBF;
	}
	//#0xB4:
	,function (parentObj) {
		parentObj.registersHL &= 0xBFFF;
	}
	//#0xB5:
	,function (parentObj) {
		parentObj.registersHL &= 0xFFBF;
	}
	//#0xB6:
	,function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) & 0xBF);
	}
	//#0xB7:
	,function (parentObj) {
		parentObj.registerA &= 0xBF;
	}
	//#0xB8:
	,function (parentObj) {
		parentObj.registerB &= 0x7F;
	}
	//#0xB9:
	,function (parentObj) {
		parentObj.registerC &= 0x7F;
	}
	//#0xBA:
	,function (parentObj) {
		parentObj.registerD &= 0x7F;
	}
	//#0xBB:
	,function (parentObj) {
		parentObj.registerE &= 0x7F;
	}
	//#0xBC:
	,function (parentObj) {
		parentObj.registersHL &= 0x7FFF;
	}
	//#0xBD:
	,function (parentObj) {
		parentObj.registersHL &= 0xFF7F;
	}
	//#0xBE:
	,function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) & 0x7F);
	}
	//#0xBF:
	,function (parentObj) {
		parentObj.registerA &= 0x7F;
	}
	//#0xC0:
	,function (parentObj) {
		parentObj.registerB |= 0x01;
	}
	//#0xC1:
	,function (parentObj) {
		parentObj.registerC |= 0x01;
	}
	//#0xC2:
	,function (parentObj) {
		parentObj.registerD |= 0x01;
	}
	//#0xC3:
	,function (parentObj) {
		parentObj.registerE |= 0x01;
	}
	//#0xC4:
	,function (parentObj) {
		parentObj.registersHL |= 0x0100;
	}
	//#0xC5:
	,function (parentObj) {
		parentObj.registersHL |= 0x01;
	}
	//#0xC6:
	,function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) | 0x01);
	}
	//#0xC7:
	,function (parentObj) {
		parentObj.registerA |= 0x01;
	}
	//#0xC8:
	,function (parentObj) {
		parentObj.registerB |= 0x02;
	}
	//#0xC9:
	,function (parentObj) {
		parentObj.registerC |= 0x02;
	}
	//#0xCA:
	,function (parentObj) {
		parentObj.registerD |= 0x02;
	}
	//#0xCB:
	,function (parentObj) {
		parentObj.registerE |= 0x02;
	}
	//#0xCC:
	,function (parentObj) {
		parentObj.registersHL |= 0x0200;
	}
	//#0xCD:
	,function (parentObj) {
		parentObj.registersHL |= 0x02;
	}
	//#0xCE:
	,function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) | 0x02);
	}
	//#0xCF:
	,function (parentObj) {
		parentObj.registerA |= 0x02;
	}
	//#0xD0:
	,function (parentObj) {
		parentObj.registerB |= 0x04;
	}
	//#0xD1:
	,function (parentObj) {
		parentObj.registerC |= 0x04;
	}
	//#0xD2:
	,function (parentObj) {
		parentObj.registerD |= 0x04;
	}
	//#0xD3:
	,function (parentObj) {
		parentObj.registerE |= 0x04;
	}
	//#0xD4:
	,function (parentObj) {
		parentObj.registersHL |= 0x0400;
	}
	//#0xD5:
	,function (parentObj) {
		parentObj.registersHL |= 0x04;
	}
	//#0xD6:
	,function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) | 0x04);
	}
	//#0xD7:
	,function (parentObj) {
		parentObj.registerA |= 0x04;
	}
	//#0xD8:
	,function (parentObj) {
		parentObj.registerB |= 0x08;
	}
	//#0xD9:
	,function (parentObj) {
		parentObj.registerC |= 0x08;
	}
	//#0xDA:
	,function (parentObj) {
		parentObj.registerD |= 0x08;
	}
	//#0xDB:
	,function (parentObj) {
		parentObj.registerE |= 0x08;
	}
	//#0xDC:
	,function (parentObj) {
		parentObj.registersHL |= 0x0800;
	}
	//#0xDD:
	,function (parentObj) {
		parentObj.registersHL |= 0x08;
	}
	//#0xDE:
	,function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) | 0x08);
	}
	//#0xDF:
	,function (parentObj) {
		parentObj.registerA |= 0x08;
	}
	//#0xE0:
	,function (parentObj) {
		parentObj.registerB |= 0x10;
	}
	//#0xE1:
	,function (parentObj) {
		parentObj.registerC |= 0x10;
	}
	//#0xE2:
	,function (parentObj) {
		parentObj.registerD |= 0x10;
	}
	//#0xE3:
	,function (parentObj) {
		parentObj.registerE |= 0x10;
	}
	//#0xE4:
	,function (parentObj) {
		parentObj.registersHL |= 0x1000;
	}
	//#0xE5:
	,function (parentObj) {
		parentObj.registersHL |= 0x10;
	}
	//#0xE6:
	,function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) | 0x10);
	}
	//#0xE7:
	,function (parentObj) {
		parentObj.registerA |= 0x10;
	}
	//#0xE8:
	,function (parentObj) {
		parentObj.registerB |= 0x20;
	}
	//#0xE9:
	,function (parentObj) {
		parentObj.registerC |= 0x20;
	}
	//#0xEA:
	,function (parentObj) {
		parentObj.registerD |= 0x20;
	}
	//#0xEB:
	,function (parentObj) {
		parentObj.registerE |= 0x20;
	}
	//#0xEC:
	,function (parentObj) {
		parentObj.registersHL |= 0x2000;
	}
	//#0xED:
	,function (parentObj) {
		parentObj.registersHL |= 0x20;
	}
	//#0xEE:
	,function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) | 0x20);
	}
	//#0xEF:
	,function (parentObj) {
		parentObj.registerA |= 0x20;
	}
	//#0xF0:
	,function (parentObj) {
		parentObj.registerB |= 0x40;
	}
	//#0xF1:
	,function (parentObj) {
		parentObj.registerC |= 0x40;
	}
	//#0xF2:
	,function (parentObj) {
		parentObj.registerD |= 0x40;
	}
	//#0xF3:
	,function (parentObj) {
		parentObj.registerE |= 0x40;
	}
	//#0xF4:
	,function (parentObj) {
		parentObj.registersHL |= 0x4000;
	}
	//#0xF5:
	,function (parentObj) {
		parentObj.registersHL |= 0x40;
	}
	//#0xF6:
	,function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) | 0x40);
	}
	//#0xF7:
	,function (parentObj) {
		parentObj.registerA |= 0x40;
	}
	//#0xF8:
	,function (parentObj) {
		parentObj.registerB |= 0x80;
	}
	//#0xF9:
	,function (parentObj) {
		parentObj.registerC |= 0x80;
	}
	//#0xFA:
	,function (parentObj) {
		parentObj.registerD |= 0x80;
	}
	//#0xFB:
	,function (parentObj) {
		parentObj.registerE |= 0x80;
	}
	//#0xFC:
	,function (parentObj) {
		parentObj.registersHL |= 0x8000;
	}
	//#0xFD:
	,function (parentObj) {
		parentObj.registersHL |= 0x80;
	}
	//#0xFE:
	,function (parentObj) {
		parentObj.memoryWriter[parentObj.registersHL](parentObj, parentObj.registersHL, parentObj.memoryReader[parentObj.registersHL](parentObj, parentObj.registersHL) | 0x80);
	}
	//#0xFF:
	,function (parentObj) {
		parentObj.registerA |= 0x80;
	}
);
GameBoyCore.prototype.TICKTable = new Array(				//Number of machine cycles for each instruction:
/*	0, 1, 2, 3, 4, 5, 6, 7,		8, 9, A, B, C, D, E, F*/
	1, 3, 2, 2, 1, 1, 2, 1,		5, 2, 2, 2, 1, 1, 2, 1,  //0
	1, 3, 2, 2, 1, 1, 2, 1,		3, 2, 2, 2, 1, 1, 2, 1,  //1
	2, 3, 2, 2, 1, 1, 2, 1,		2, 2, 2, 2, 1, 1, 2, 1,  //2
	2, 3, 2, 2, 3, 3, 3, 1,		2, 2, 2, 2, 1, 1, 2, 1,  //3

	1, 1, 1, 1, 1, 1, 2, 1,		1, 1, 1, 1, 1, 1, 2, 1,  //4
	1, 1, 1, 1, 1, 1, 2, 1,		1, 1, 1, 1, 1, 1, 2, 1,  //5
	1, 1, 1, 1, 1, 1, 2, 1,		1, 1, 1, 1, 1, 1, 2, 1,  //6
	2, 2, 2, 2, 2, 2, 1, 2,		1, 1, 1, 1, 1, 1, 2, 1,  //7

	1, 1, 1, 1, 1, 1, 2, 1,		1, 1, 1, 1, 1, 1, 2, 1,  //8
	1, 1, 1, 1, 1, 1, 2, 1,		1, 1, 1, 1, 1, 1, 2, 1,  //9
	1, 1, 1, 1, 1, 1, 2, 1,		1, 1, 1, 1, 1, 1, 2, 1,  //A
	1, 1, 1, 1, 1, 1, 2, 1,		1, 1, 1, 1, 1, 1, 2, 1,  //B

	2, 3, 3, 4, 3, 4, 2, 4,		2, 4, 3, 2, 3, 6, 2, 4,  //C
	2, 3, 3, 1, 3, 4, 2, 4,		2, 4, 3, 1, 3, 1, 2, 4,  //D
	3, 3, 2, 1, 1, 4, 2, 4,		4, 1, 4, 1, 1, 1, 2, 4,  //E
	3, 3, 2, 1, 1, 4, 2, 4,		3, 2, 4, 1, 0, 1, 2, 4   //F
);
GameBoyCore.prototype.SecondaryTICKTable = new Array(		//Number of machine cycles for each 0xCBXX instruction:
/*	0, 1, 2, 3, 4, 5, 6, 7,		8, 9, A, B, C, D, E, F*/
	2, 2, 2, 2, 2, 2, 4, 2,		2, 2, 2, 2, 2, 2, 4, 2,  //0
	2, 2, 2, 2, 2, 2, 4, 2,		2, 2, 2, 2, 2, 2, 4, 2,  //1
	2, 2, 2, 2, 2, 2, 4, 2,		2, 2, 2, 2, 2, 2, 4, 2,  //2
	2, 2, 2, 2, 2, 2, 4, 2,		2, 2, 2, 2, 2, 2, 4, 2,  //3

	2, 2, 2, 2, 2, 2, 3, 2,		2, 2, 2, 2, 2, 2, 3, 2,  //4
	2, 2, 2, 2, 2, 2, 3, 2,		2, 2, 2, 2, 2, 2, 3, 2,  //5
	2, 2, 2, 2, 2, 2, 3, 2,		2, 2, 2, 2, 2, 2, 3, 2,  //6
	2, 2, 2, 2, 2, 2, 3, 2,		2, 2, 2, 2, 2, 2, 3, 2,  //7

	2, 2, 2, 2, 2, 2, 4, 2,		2, 2, 2, 2, 2, 2, 4, 2,  //8
	2, 2, 2, 2, 2, 2, 4, 2,		2, 2, 2, 2, 2, 2, 4, 2,  //9
	2, 2, 2, 2, 2, 2, 4, 2,		2, 2, 2, 2, 2, 2, 4, 2,  //A
	2, 2, 2, 2, 2, 2, 4, 2,		2, 2, 2, 2, 2, 2, 4, 2,  //B

	2, 2, 2, 2, 2, 2, 4, 2,		2, 2, 2, 2, 2, 2, 4, 2,  //C
	2, 2, 2, 2, 2, 2, 4, 2,		2, 2, 2, 2, 2, 2, 4, 2,  //D
	2, 2, 2, 2, 2, 2, 4, 2,		2, 2, 2, 2, 2, 2, 4, 2,  //E
	2, 2, 2, 2, 2, 2, 4, 2,		2, 2, 2, 2, 2, 2, 4, 2   //F
);
GameBoyCore.prototype.saveSRAMState = function () {
	if (!this.cBATT || this.MBCRam.length == 0) {
		//No battery backup...
		return [];
	}
	else {
		//Return the MBC RAM for backup...
		return this.fromTypedArray(this.MBCRam);
	}
}
GameBoyCore.prototype.saveRTCState = function () {
	if (!this.cTIMER) {
		//No battery backup...
		return [];
	}
	else {
		//Return the MBC RAM for backup...
		return [
			this.lastIteration,
			this.RTCisLatched,
			this.latchedSeconds,
			this.latchedMinutes,
			this.latchedHours,
			this.latchedLDays,
			this.latchedHDays,
			this.RTCSeconds,
			this.RTCMinutes,
			this.RTCHours,
			this.RTCDays,
			this.RTCDayOverFlow,
			this.RTCHALT
		];
	}
}
GameBoyCore.prototype.saveState = function () {
	return [
		this.fromTypedArray(this.ROM),
		this.inBootstrap,
		this.registerA,
		this.FZero,
		this.FSubtract,
		this.FHalfCarry,
		this.FCarry,
		this.registerB,
		this.registerC,
		this.registerD,
		this.registerE,
		this.registersHL,
		this.stackPointer,
		this.programCounter,
		this.halt,
		this.IME,
		this.hdmaRunning,
		this.CPUTicks,
		this.multiplier,
		this.fromTypedArray(this.memory),
		this.fromTypedArray(this.MBCRam),
		this.fromTypedArray(this.VRAM),
		this.currVRAMBank,
		this.fromTypedArray(this.GBCMemory),
		this.MBC1Mode,
		this.MBCRAMBanksEnabled,
		this.currMBCRAMBank,
		this.currMBCRAMBankPosition,
		this.cGBC,
		this.gbcRamBank,
		this.gbcRamBankPosition,
		this.ROMBank1offs,
		this.currentROMBank,
		this.cartridgeType,
		this.name,
		this.gameCode,
		this.modeSTAT,
		this.LYCMatchTriggerSTAT,
		this.mode2TriggerSTAT,
		this.mode1TriggerSTAT,
		this.mode0TriggerSTAT,
		this.LCDisOn,
		this.gfxWindowCHRBankPosition,
		this.gfxWindowDisplay,
		this.gfxSpriteShow,
		this.gfxSpriteDouble,
		this.gfxBackgroundCHRBankPosition,
		this.gfxBackgroundBankOffset,
		this.TIMAEnabled,
		this.DIVTicks,
		this.LCDTicks,
		this.timerTicks,
		this.TACClocker,
		this.IRQEnableDelay,
		this.lastIteration,
		this.cMBC1,
		this.cMBC2,
		this.cMBC3,
		this.cMBC5,
		this.cMBC7,
		this.cSRAM,
		this.cMMMO1,
		this.cRUMBLE,
		this.cCamera,
		this.cTAMA5,
		this.cHuC3,
		this.cHuC1,
		this.drewBlank,
		this.fromTypedArray(this.frameBuffer),
		this.bgEnabled,
		this.BGPriorityEnabled,
		this.channel1adjustedFrequencyPrep,
		this.channel1lastSampleLookup,
		this.channel1adjustedDuty,
		this.channel1totalLength,
		this.channel1envelopeVolume,
		this.channel1currentVolume,
		this.channel1envelopeType,
		this.channel1envelopeSweeps,
		this.channel1consecutive,
		this.channel1frequency,
		this.channel1volumeEnvTime,
		this.channel1volumeEnvTimeLast,
		this.channel1lastTotalLength,
		this.channel1timeSweep,
		this.channel1lastTimeSweep,
		this.channel1numSweep,
		this.channel1frequencySweepDivider,
		this.channel1decreaseSweep,
		this.channel2adjustedFrequencyPrep,
		this.channel2lastSampleLookup,
		this.channel2adjustedDuty,
		this.channel2totalLength,
		this.channel2envelopeVolume,
		this.channel2currentVolume,
		this.channel2envelopeType,
		this.channel2envelopeSweeps,
		this.channel2consecutive,
		this.channel2frequency,
		this.channel2volumeEnvTime,
		this.channel2volumeEnvTimeLast,
		this.channel2lastTotalLength,
		this.channel3canPlay,
		this.channel3totalLength,
		this.channel3lastTotalLength,
		this.channel3patternType,
		this.channel3frequency,
		this.channel3consecutive,
		this.fromTypedArray(this.channel3PCM),
		this.channel3adjustedFrequencyPrep,
		this.channel4adjustedFrequencyPrep,
		this.channel4lastSampleLookup,
		this.channel4totalLength,
		this.channel4envelopeVolume,
		this.channel4currentVolume,
		this.channel4envelopeType,
		this.channel4envelopeSweeps,
		this.channel4consecutive,
		this.channel4volumeEnvTime,
		this.channel4volumeEnvTimeLast,
		this.channel4lastTotalLength,
		this.soundMasterEnabled,
		this.VinLeftChannelEnabled,
		this.VinRightChannelEnabled,
		this.VinLeftChannelMasterVolume,
		this.VinRightChannelMasterVolume,
		this.leftChannel,
		this.rightChannel,
		this.actualScanLine,
		this.RTCisLatched,
		this.latchedSeconds,
		this.latchedMinutes,
		this.latchedHours,
		this.latchedLDays,
		this.latchedHDays,
		this.RTCSeconds,
		this.RTCMinutes,
		this.RTCHours,
		this.RTCDays,
		this.RTCDayOverFlow,
		this.RTCHALT,
		this.usedBootROM,
		this.skipPCIncrement,
		this.STATTracker,
		this.gbcRamBankPositionECHO,
		this.numRAMBanks,
		this.windowY,
		this.windowX,
		this.returnOAMXCacheCopy(this.OAMAddresses),
		this.fromTypedArray(this.gbcOBJRawPalette),
		this.fromTypedArray(this.gbcBGRawPalette),
		this.fromTypedArray(this.gbOBJPalette),
		this.fromTypedArray(this.gbBGPalette),
		this.fromTypedArray(this.gbcOBJPalette),
		this.fromTypedArray(this.gbcBGPalette),
		this.fromTypedArray(this.gbBGColorizedPalette),
		this.fromTypedArray(this.gbOBJColorizedPalette),
		this.fromTypedArray(this.cachedBGPaletteConversion),
		this.fromTypedArray(this.cachedOBJPaletteConversion),
		this.fromTypedArray(this.BGCHRBank1),
		this.fromTypedArray(this.BGCHRBank2),
		this.haltPostClocks,
		this.interruptsRequested,
		this.interruptsEnabled
	];
}
GameBoyCore.prototype.returnFromState = function (returnedFrom) {
	var index = 0;
	var state = returnedFrom.slice(0);
	this.ROM = this.toTypedArray(state[index++], "uint8");
	this.inBootstrap = state[index++];
	this.registerA = state[index++];
	this.FZero = state[index++];
	this.FSubtract = state[index++];
	this.FHalfCarry = state[index++];
	this.FCarry = state[index++];
	this.registerB = state[index++];
	this.registerC = state[index++];
	this.registerD = state[index++];
	this.registerE = state[index++];
	this.registersHL = state[index++];
	this.stackPointer = state[index++];
	this.programCounter = state[index++];
	this.halt = state[index++];
	this.IME = state[index++];
	this.hdmaRunning = state[index++];
	this.CPUTicks = state[index++];
	this.multiplier = state[index++];
	this.memory = this.toTypedArray(state[index++], "uint8");
	this.MBCRam = this.toTypedArray(state[index++], "uint8");
	this.VRAM = this.toTypedArray(state[index++], "uint8");
	this.currVRAMBank = state[index++];
	this.GBCMemory = this.toTypedArray(state[index++], "uint8");
	this.MBC1Mode = state[index++];
	this.MBCRAMBanksEnabled = state[index++];
	this.currMBCRAMBank = state[index++];
	this.currMBCRAMBankPosition = state[index++];
	this.cGBC = state[index++];
	this.gbcRamBank = state[index++];
	this.gbcRamBankPosition = state[index++];
	this.ROMBank1offs = state[index++];
	this.currentROMBank = state[index++];
	this.cartridgeType = state[index++];
	this.name = state[index++];
	this.gameCode = state[index++];
	this.modeSTAT = state[index++];
	this.LYCMatchTriggerSTAT = state[index++];
	this.mode2TriggerSTAT = state[index++];
	this.mode1TriggerSTAT = state[index++];
	this.mode0TriggerSTAT = state[index++];
	this.LCDisOn = state[index++];
	this.gfxWindowCHRBankPosition = state[index++];
	this.gfxWindowDisplay = state[index++];
	this.gfxSpriteShow = state[index++];
	this.gfxSpriteDouble = state[index++];
	this.gfxBackgroundCHRBankPosition = state[index++];
	this.gfxBackgroundBankOffset = state[index++];
	this.TIMAEnabled = state[index++];
	this.DIVTicks = state[index++];
	this.LCDTicks = state[index++];
	this.timerTicks = state[index++];
	this.TACClocker = state[index++];
	this.IRQEnableDelay = state[index++];
	this.lastIteration = state[index++];
	this.cMBC1 = state[index++];
	this.cMBC2 = state[index++];
	this.cMBC3 = state[index++];
	this.cMBC5 = state[index++];
	this.cMBC7 = state[index++];
	this.cSRAM = state[index++];
	this.cMMMO1 = state[index++];
	this.cRUMBLE = state[index++];
	this.cCamera = state[index++];
	this.cTAMA5 = state[index++];
	this.cHuC3 = state[index++];
	this.cHuC1 = state[index++];
	this.drewBlank = state[index++];
	this.frameBuffer = this.toTypedArray(state[index++], "int32");
	this.bgEnabled = state[index++];
	this.BGPriorityEnabled = state[index++];
	this.channel1adjustedFrequencyPrep = state[index++];
	this.channel1lastSampleLookup = state[index++];
	this.channel1adjustedDuty = state[index++];
	this.channel1totalLength = state[index++];
	this.channel1envelopeVolume = state[index++];
	this.channel1currentVolume = state[index++];
	this.channel1envelopeType = state[index++];
	this.channel1envelopeSweeps = state[index++];
	this.channel1consecutive = state[index++];
	this.channel1frequency = state[index++];
	this.channel1volumeEnvTime = state[index++];
	this.channel1volumeEnvTimeLast = state[index++];
	this.channel1lastTotalLength = state[index++];
	this.channel1timeSweep = state[index++];
	this.channel1lastTimeSweep = state[index++];
	this.channel1numSweep = state[index++];
	this.channel1frequencySweepDivider = state[index++];
	this.channel1decreaseSweep = state[index++];
	this.channel2adjustedFrequencyPrep = state[index++];
	this.channel2lastSampleLookup = state[index++];
	this.channel2adjustedDuty = state[index++];
	this.channel2totalLength = state[index++];
	this.channel2envelopeVolume = state[index++];
	this.channel2currentVolume = state[index++];
	this.channel2envelopeType = state[index++];
	this.channel2envelopeSweeps = state[index++];
	this.channel2consecutive = state[index++];
	this.channel2frequency = state[index++];
	this.channel2volumeEnvTime = state[index++];
	this.channel2volumeEnvTimeLast = state[index++];
	this.channel2lastTotalLength = state[index++];
	this.channel3canPlay = state[index++];
	this.channel3totalLength = state[index++];
	this.channel3lastTotalLength = state[index++];
	this.channel3patternType = state[index++];
	this.channel3frequency = state[index++];
	this.channel3consecutive = state[index++];
	this.channel3PCM = this.toTypedArray(state[index++], "float32");
	this.channel3adjustedFrequencyPrep = state[index++];
	this.channel4adjustedFrequencyPrep = state[index++];
	this.channel4lastSampleLookup = state[index++];
	this.channel4totalLength = state[index++];
	this.channel4envelopeVolume = state[index++];
	this.channel4currentVolume = state[index++];
	this.channel4envelopeType = state[index++];
	this.channel4envelopeSweeps = state[index++];
	this.channel4consecutive = state[index++];
	this.channel4volumeEnvTime = state[index++];
	this.channel4volumeEnvTimeLast = state[index++];
	this.channel4lastTotalLength = state[index++];
	this.soundMasterEnabled = state[index++];
	this.VinLeftChannelEnabled = state[index++];
	this.VinRightChannelEnabled = state[index++];
	this.VinLeftChannelMasterVolume = state[index++];
	this.VinRightChannelMasterVolume = state[index++];
	this.leftChannel = state[index++];
	this.rightChannel = state[index++];
	this.actualScanLine = state[index++];
	this.RTCisLatched = state[index++];
	this.latchedSeconds = state[index++];
	this.latchedMinutes = state[index++];
	this.latchedHours = state[index++];
	this.latchedLDays = state[index++];
	this.latchedHDays = state[index++];
	this.RTCSeconds = state[index++];
	this.RTCMinutes = state[index++];
	this.RTCHours = state[index++];
	this.RTCDays = state[index++];
	this.RTCDayOverFlow = state[index++];
	this.RTCHALT = state[index++];
	this.usedBootROM = state[index++];
	this.skipPCIncrement = state[index++];
	this.STATTracker = state[index++];
	this.gbcRamBankPositionECHO = state[index++];
	this.numRAMBanks = state[index++];
	this.windowY = state[index++];
	this.windowX = state[index++];
	this.OAMAddresses = this.returnOAMXCacheCopy(state[index++]);
	this.gbcOBJRawPalette = this.toTypedArray(state[index++], "uint8");
	this.gbcBGRawPalette = this.toTypedArray(state[index++], "uint8");
	this.gbOBJPalette = this.toTypedArray(state[index++], "int32");
	this.gbBGPalette = this.toTypedArray(state[index++], "int32");
	this.gbcOBJPalette = this.toTypedArray(state[index++], "int32");
	this.gbcBGPalette = this.toTypedArray(state[index++], "int32");
	this.gbBGColorizedPalette = this.toTypedArray(state[index++], "int32");
	this.gbOBJColorizedPalette = this.toTypedArray(state[index++], "int32");
	this.cachedBGPaletteConversion = this.toTypedArray(state[index++], "int32");
	this.cachedOBJPaletteConversion = this.toTypedArray(state[index++], "int32");
	this.BGCHRBank1 = this.toTypedArray(state[index++], "uint8");
	this.BGCHRBank2 = this.toTypedArray(state[index++], "uint8");
	this.haltPostClocks = state[index++];
	this.interruptsRequested = state[index++];
	this.interruptsEnabled = state[index];
	this.fromSaveState = true;
	this.initializeLCDController();
	this.convertAuxilliary();
	this.consoleModeAdjust();
	this.memoryReadJumpCompile();
	this.memoryWriteJumpCompile();
	this.initLCD();
	this.initSound();
	this.drawToCanvas();
}
GameBoyCore.prototype.returnFromRTCState = function () {
	if (typeof this.openRTC == "function" && this.cTIMER) {
		var rtcData = this.openRTC(this.name);
		var index = 0;
		this.lastIteration = rtcData[index++];
		this.RTCisLatched = rtcData[index++];
		this.latchedSeconds = rtcData[index++];
		this.latchedMinutes = rtcData[index++];
		this.latchedHours = rtcData[index++];
		this.latchedLDays = rtcData[index++];
		this.latchedHDays = rtcData[index++];
		this.RTCSeconds = rtcData[index++];
		this.RTCMinutes = rtcData[index++];
		this.RTCHours = rtcData[index++];
		this.RTCDays = rtcData[index++];
		this.RTCDayOverFlow = rtcData[index++];
		this.RTCHALT = rtcData[index];
	}
}
GameBoyCore.prototype.start = function () {
	settings[4] = 0;	//Reset the frame skip setting.
	this.initializeLCDController();	//Compile the LCD controller functions.
	this.initMemory();	//Write the startup memory.
	this.ROMLoad();		//Load the ROM into memory and get cartridge information from it.
	this.initLCD();		//Initialize the graphics.
	this.initSound();	//Sound object initialization.
	this.run();			//Start the emulation.
}
GameBoyCore.prototype.convertAuxilliary = function () {
	try {
		this.TICKTable = new Uint8Array(this.TICKTable);
		this.SecondaryTICKTable = new Uint8Array(this.SecondaryTICKTable);
	}
	catch (error) {
		cout("Could not convert the auxilliary arrays to typed arrays (Error \"" + error.message + "\").", 1);
	}
}
GameBoyCore.prototype.initMemory = function () {
	//Initialize the RAM:
	this.memory = this.getTypedArray(0x10000, 0, "uint8");
	this.frameBuffer = this.getTypedArray(23040, 0xF8F8F8, "int32");
	this.gbcOBJRawPalette = this.getTypedArray(0x40, 0, "uint8");
	this.gbcBGRawPalette = this.getTypedArray(0x40, 0, "uint8");
	this.gbOBJPalette = this.getTypedArray(8, 0, "int32");
	this.gbBGPalette = this.getTypedArray(4, 0, "int32");
	this.gbcOBJPalette = this.getTypedArray(0x20, 0, "int32");
	this.gbcBGPalette = this.getTypedArray(0x20, 0, "int32");
	this.gbBGColorizedPalette = this.getTypedArray(4, 0, "int32");
	this.gbOBJColorizedPalette = this.getTypedArray(8, 0, "int32");
	this.cachedBGPaletteConversion = this.getTypedArray(4, 0, "int32");
	this.cachedOBJPaletteConversion = this.getTypedArray(8, 0, "int32");
	this.BGCHRBank1 = this.getTypedArray(0x800, 0, "uint8");
	this.BGCHRBank2 = this.getTypedArray(0x800, 0, "uint8");
	this.BGCHRCurrentBank = this.BGCHRBank1;
	this.convertAuxilliary();
}
GameBoyCore.prototype.generateCacheArray = function (tileAmount) {
	var tileArray = new Array(tileAmount);
	for (var tileNumber = 0; tileNumber < tileAmount; tileNumber++) {
		tileArray[tileNumber] = new Array(8);
		for (var y = 0; y < 8; y++) {
			tileArray[tileNumber][y] = this.getTypedArray(8, 0, "uint8");
			for (var x = 0; x < 8; x++) {
				tileArray[tileNumber][y][x] = 0;
			}
		}
	}
	return tileArray;
}
GameBoyCore.prototype.initSkipBootstrap = function () {
	//Start as an unset device:
	cout("Starting without the GBC boot ROM.", 0);
	this.programCounter = 0x100;
	this.stackPointer = 0xFFFE;
	this.IME = true;
	this.DIVTicks = 14;
	this.registerA = (this.cGBC) ? 0x11 : 0x1;
	this.registerB = 0;
	this.registerC = 0x13;
	this.registerD = 0;
	this.registerE = 0xD8;
	this.FZero = true;
	this.FSubtract = false;
	this.FHalfCarry = true;
	this.FCarry = true;
	this.registersHL = 0x014D;
	this.VinLeftChannelMasterVolume = 1;
	this.VinRightChannelMasterVolume = 1;
	this.leftChannel = this.ArrayPad(4, true);
	this.rightChannel = this.ArrayPad(4, true);
	this.LCDCONTROL = this.LINECONTROL;
	this.LCDisOn = true;
	this.modeSTAT = 3;
	this.STATTracker = 1;
	this.LCDTicks = 20;	//Boot ROM officially supposed to leave in mode 3.
	this.actualScanLine = 0;
	this.gfxWindowCHRBankPosition = 0;
	this.gfxWindowDisplay = false;
	this.gfxBackgroundBankOffset = 0x80;
	this.gfxBackgroundCHRBankPosition = 0;
	this.gfxSpriteDouble = false;
	this.gfxSpriteShow = false;
	this.BGPriorityEnabled = true;
	//Fill in the boot ROM set register values
	//Default values to the GB boot ROM values, then fill in the GBC boot ROM values after ROM loading
	var index = 0xFF;
	while (index >= 0) {
		if (index >= 0x30 && index < 0x40) {
			this.memoryWrite(0xFF00 | index, this.ffxxDump[index]);
		}
		else {
			switch (index) {
				case 0x00:
				case 0x01:
				case 0x02:
				case 0x05:
				case 0x07:
				case 0x0F:
				case 0xFF:
					this.memoryWrite(0xFF00 | index, this.ffxxDump[index]);
					break;
				default:
					this.memory[0xFF00 | index] = this.ffxxDump[index];
			}
		}
		index--;
	}
	if (this.cGBC) {
		this.memory[0xFF6C] = 0xFE;
		this.memory[0xFF74] = 0xFE;
	}
	else {
		this.memory[0xFF48] = 0xFF;
		this.memory[0xFF49] = 0xFF;
		this.memory[0xFF6C] = 0xFF;
		this.memory[0xFF74] = 0xFF;
	}
}
GameBoyCore.prototype.initBootstrap = function () {
	//Start as an unset device:
	cout("Starting the GBC boot ROM.", 0);
	this.programCounter = 0;
	this.stackPointer = 0;
	this.IME = false;
	this.LCDTicks = 0;
	this.DIVTicks = 0;
	this.registerA = 0;
	this.registerB = 0;
	this.registerC = 0;
	this.registerD = 0;
	this.registerE = 0;
	this.FZero = this.FSubtract = this.FHalfCarry = this.FCarry = false;
	this.registersHL = 0;
	this.leftChannel = this.ArrayPad(4, false);
	this.rightChannel = this.ArrayPad(4, false);
	this.channel2frequency = this.channel1frequency = 0;
	this.channel2volumeEnvTime = this.channel1volumeEnvTime = 0;
	this.channel4consecutive = this.channel2consecutive = this.channel1consecutive = false;
	this.VinLeftChannelMasterVolume = 1;
	this.VinRightChannelMasterVolume = 1;
	this.memory[0xFF00] = 0xF;	//Set the joypad state.
}
GameBoyCore.prototype.ROMLoad = function () {
	//Load the first two ROM banks (0x0000 - 0x7FFF) into regular gameboy memory:
	this.ROM = [];
	this.usedBootROM = settings[16];
	for (var romIndex = 0, maxLength = this.ROMImage.length; romIndex < maxLength; romIndex++) {
		this.ROM[romIndex] = (this.ROMImage.charCodeAt(romIndex) & 0xFF);
	}
	maxLength = Math.min(romIndex, 0x8000);
	for (romIndex = 0; romIndex < maxLength; romIndex++) {
		if (!this.usedBootROM || romIndex >= 0x900 || (romIndex >= 0x100 && romIndex < 0x200)) {
			this.memory[romIndex] = this.ROM[romIndex];		//Load in the game ROM.
		}
		else {
			this.memory[romIndex] = this.GBCBOOTROM[romIndex];	//Load in the GameBoy Color BOOT ROM.
		}
	}
	if (!settings[22]) {
		try {
			this.ROM = new Uint8Array(this.ROM);
		}
		catch (error) {}
	}
	// ROM name
	for (var index = 0x134; index < 0x13F; index++) {
		if (this.ROMImage.charCodeAt(index) > 0) {
			this.name += this.ROMImage[index];
		}
	}
	// ROM game code (for newer games)
	for (var index = 0x13F; index < 0x143; index++) {
		if (this.ROMImage.charCodeAt(index) > 0) {
			this.gameCode += this.ROMImage[index];
		}
	}
	cout("Game Title: " + this.name + "[" + this.gameCode + "][" + this.ROMImage[0x143] + "]", 0);
	cout("Game Code: " + this.gameCode, 0);
	// Cartridge type
	this.cartridgeType = this.ROM[0x147];
	cout("Cartridge type #" + this.cartridgeType, 0);
	//Map out ROM cartridge sub-types.
	var MBCType = "";
	switch (this.cartridgeType) {
		case 0x00:
			//ROM w/o bank switching
			if (!settings[9]) {
				MBCType = "ROM";
				break;
			}
		case 0x01:
			this.cMBC1 = true;
			MBCType = "MBC1";
			break;
		case 0x02:
			this.cMBC1 = true;
			this.cSRAM = true;
			MBCType = "MBC1 + SRAM";
			break;
		case 0x03:
			this.cMBC1 = true;
			this.cSRAM = true;
			this.cBATT = true;
			MBCType = "MBC1 + SRAM + BATT";
			break;
		case 0x05:
			this.cMBC2 = true;
			MBCType = "MBC2";
			break;
		case 0x06:
			this.cMBC2 = true;
			this.cBATT = true;
			MBCType = "MBC2 + BATT";
			break;
		case 0x08:
			this.cSRAM = true;
			MBCType = "ROM + SRAM";
			break;
		case 0x09:
			this.cSRAM = true;
			this.cBATT = true;
			MBCType = "ROM + SRAM + BATT";
			break;
		case 0x0B:
			this.cMMMO1 = true;
			MBCType = "MMMO1";
			break;
		case 0x0C:
			this.cMMMO1 = true;
			this.cSRAM = true;
			MBCType = "MMMO1 + SRAM";
			break;
		case 0x0D:
			this.cMMMO1 = true;
			this.cSRAM = true;
			this.cBATT = true;
			MBCType = "MMMO1 + SRAM + BATT";
			break;
		case 0x0F:
			this.cMBC3 = true;
			this.cTIMER = true;
			this.cBATT = true;
			MBCType = "MBC3 + TIMER + BATT";
			break;
		case 0x10:
			this.cMBC3 = true;
			this.cTIMER = true;
			this.cBATT = true;
			this.cSRAM = true;
			MBCType = "MBC3 + TIMER + BATT + SRAM";
			break;
		case 0x11:
			this.cMBC3 = true;
			MBCType = "MBC3";
			break;
		case 0x12:
			this.cMBC3 = true;
			this.cSRAM = true;
			MBCType = "MBC3 + SRAM";
			break;
		case 0x13:
			this.cMBC3 = true;
			this.cSRAM = true;
			this.cBATT = true;
			MBCType = "MBC3 + SRAM + BATT";
			break;
		case 0x19:
			this.cMBC5 = true;
			MBCType = "MBC5";
			break;
		case 0x1A:
			this.cMBC5 = true;
			this.cSRAM = true;
			MBCType = "MBC5 + SRAM";
			break;
		case 0x1B:
			this.cMBC5 = true;
			this.cSRAM = true;
			this.cBATT = true;
			MBCType = "MBC5 + SRAM + BATT";
			break;
		case 0x1C:
			this.cRUMBLE = true;
			MBCType = "RUMBLE";
			break;
		case 0x1D:
			this.cRUMBLE = true;
			this.cSRAM = true;
			MBCType = "RUMBLE + SRAM";
			break;
		case 0x1E:
			this.cRUMBLE = true;
			this.cSRAM = true;
			this.cBATT = true;
			MBCType = "RUMBLE + SRAM + BATT";
			break;
		case 0x1F:
			this.cCamera = true;
			MBCType = "GameBoy Camera";
			break;
		case 0x22:
			this.cMBC7 = true;
			this.cSRAM = true;
			this.cBATT = true;
			MBCType = "MBC7 + SRAM + BATT";
			break;
		case 0xFD:
			this.cTAMA5 = true;
			MBCType = "TAMA5";
			break;
		case 0xFE:
			this.cHuC3 = true;
			MBCType = "HuC3";
			break;
		case 0xFF:
			this.cHuC1 = true;
			MBCType = "HuC1";
			break;
		default:
			MBCType = "Unknown";
			cout("Cartridge type is unknown.", 2);
			pause();
	}
	cout("Cartridge Type: " + MBCType + ".", 0);
	// ROM and RAM banks
	this.numROMBanks = this.ROMBanks[this.ROM[0x148]];
	cout(this.numROMBanks + " ROM banks.", 0);
	switch (this.RAMBanks[this.ROM[0x149]]) {
		case 0:
			cout("No RAM banking requested for allocation or MBC is of type 2.", 0);
			break;
		case 2:
			cout("1 RAM bank requested for allocation.", 0);
			break;
		case 3:
			cout("4 RAM banks requested for allocation.", 0);
			break;
		case 4:
			cout("16 RAM banks requested for allocation.", 0);
			break;
		default:
			cout("RAM bank amount requested is unknown, will use maximum allowed by specified MBC type.", 0);
	}
	//Check the GB/GBC mode byte:
	if (!this.usedBootROM) {
		switch (this.ROM[0x143]) {
			case 0x00:	//Only GB mode
				this.cGBC = false;
				cout("Only GB mode detected.", 0);
				break;
			case 0x80:	//Both GB + GBC modes
				this.cGBC = !settings[2];
				cout("GB and GBC mode detected.", 0);
				break;
			case 0xC0:	//Only GBC mode
				this.cGBC = true;
				cout("Only GBC mode detected.", 0);
				break;
			default:
				this.cGBC = false;
				cout("Unknown GameBoy game type code #" + this.ROM[0x143] + ", defaulting to GB mode (Old games don't have a type code).", 1);
		}
		this.inBootstrap = false;
		this.setupRAM();	//CPU/(V)RAM initialization.
		this.initSkipBootstrap();
	}
	else {
		this.cGBC = true;	//Allow the GBC boot ROM to run in GBC mode...
		this.setupRAM();	//CPU/(V)RAM initialization.
		this.initBootstrap();
	}
	this.consoleModeAdjust();
	//License Code Lookup:
	var cOldLicense = this.ROM[0x14B];
	var cNewLicense = (this.ROM[0x144] & 0xFF00) | (this.ROM[0x145] & 0xFF);
	if (cOldLicense != 0x33) {
		//Old Style License Header
		cout("Old style license code: " + cOldLicense, 0);
	}
	else {
		//New Style License Header
		cout("New style license code: " + cNewLicense, 0);
	}
}
GameBoyCore.prototype.disableBootROM = function () {
	//Remove any traces of the boot ROM from ROM memory.
	for (var index = 0; index < 0x900; index++) {
		if (index < 0x100 || index >= 0x200) {		//Skip the already loaded in ROM header.
			this.memory[index] = this.ROM[index];	//Replace the GameBoy Color boot ROM with the game ROM.
		}
	}
	this.consoleModeAdjust();
	if (!this.cGBC) {
		//Clean up the post-boot (GB mode only) state:
		cout("Stepping down from GBC mode.", 0);
		this.getGBCColor();
		this.BGCHRBank2 = this.VRAM = this.GBCMemory = null;	//Deleting these causes Google's V8 engine and Safari's JSC to deoptimize heavily.
		for (index = 0; index < 0x100; index++) {
			this.OAMAddresses[index] = [];
		}
	}
	this.memoryReadJumpCompile();
	this.memoryWriteJumpCompile();
}
GameBoyCore.prototype.initializeTiming = function () {
	//Emulator Timing:
	this.CPUCyclesPerIteration = (41943 / 40) * settings[20];
	//Audio Timing:
	this.preChewedAudioComputationMultiplier = 0x20000 / settings[14];
	this.preChewedWAVEAudioComputationMultiplier = 0x200000 / settings[14];
	this.whiteNoiseFrequencyPreMultiplier = 4194300 / settings[14] / 8;
	this.volumeEnvelopePreMultiplier = settings[14] / 0x40;
	this.channel1TimeSweepPreMultiplier = settings[14] / 0x80;
	this.audioTotalLengthMultiplier = settings[14] / 0x100;
}
GameBoyCore.prototype.setupRAM = function () {
	//Setup the auxilliary/switchable RAM to their maximum possible size (Bad headers can lie).
	if (this.cMBC2) {
		this.numRAMBanks = 1 / 16;
	}
	else if (this.cMBC1 || this.cRUMBLE || this.cMBC3 || this.cHuC3) {
		this.numRAMBanks = 4;
	}
	else if (this.cMBC5) {
		this.numRAMBanks = 16;
	}
	else if (this.cSRAM) {
		this.numRAMBanks = 1;
	}
	if (this.numRAMBanks > 0) {
		if (!this.MBCRAMUtilized()) {
			//For ROM and unknown MBC cartridges using the external RAM:
			this.MBCRAMBanksEnabled = true;
		}
		//Switched RAM Used
		var MBCRam = (typeof this.openMBC == "function") ? this.openMBC(this.name) : [];
		if (MBCRam.length > 0) {
			//Flash the SRAM into memory:
			this.MBCRam = this.toTypedArray(MBCRam, "uint8");
		}
		else {
			this.MBCRam = this.getTypedArray(this.numRAMBanks * 0x2000, 0, "uint8");
		}
	}
	cout("Actual bytes of MBC RAM allocated: " + (this.numRAMBanks * 0x2000), 0);
	this.returnFromRTCState();
	//Setup the RAM for GBC mode.
	if (this.cGBC) {
		this.VRAM = this.getTypedArray(0x2000, 0, "uint8");
		this.GBCMemory = this.getTypedArray(0x7000, 0, "uint8");
	}
	else {
		this.tileCache = this.generateCacheArray(0x700);
		this.tileCacheValid = this.getTypedArray(0x700, 0, "int8");
		for (index = 0; index < 0x100; index++) {
			this.OAMAddresses[index] = [];
		}
	}
	this.memoryReadJumpCompile();
	this.memoryWriteJumpCompile();
}
GameBoyCore.prototype.MBCRAMUtilized = function () {
	return this.cMBC1 || this.cMBC2 || this.cMBC3 || this.cMBC5 || this.cMBC7 || this.cRUMBLE;
}
GameBoyCore.prototype.initLCD = function () {
	this.scaledFrameBuffer = this.getTypedArray(this.pixelCount, 0, "int32");	//Used for software side scaling...
	this.compileResizeFrameBufferFunction();
	try {
		if (settings[5]) {
			//Nasty since we are throwing on purpose to force a try/catch fallback
			throw(new Error("Canvas 2D API path disabled."));
		}
		this.drawContext = this.canvas.getContext("2d");
		//Get a CanvasPixelArray buffer:
		try {
			this.canvasBuffer = this.drawContext.createImageData(this.width, this.height);
		}
		catch (error) {
			cout("Falling back to the getImageData initialization (Error \"" + error.message + "\").", 1);
			this.canvasBuffer = this.drawContext.getImageData(0, 0, this.width, this.height);
		}
		var index = 23040;
		var index2 = this.rgbCount;
		while (index > 0) {
			this.frameBuffer[--index] = 0xF8F8F8;
		}
		while (index2 > 0) {
			this.canvasBuffer.data[index2 -= 4] = 0xF8;
			this.canvasBuffer.data[index2 + 1] = 0xF8;
			this.canvasBuffer.data[index2 + 2] = 0xF8;
			this.canvasBuffer.data[index2 + 3] = 0xFF;
		}
		this.drawContext.putImageData(this.canvasBuffer, 0, 0);		//Throws any browser that won't support this later on.
		this.canvasAlt.style.visibility = "hidden";	//Make sure, if restarted, that the fallback images aren't going cover the canvas.
		this.canvas.style.visibility = "visible";
		this.canvasFallbackHappened = false;
	}
	catch (error) {
		//Falling back to an experimental data URI BMP file canvas alternative:
		cout("Falling back to BMP imaging as a canvas alternative: " + error.message, 1);
		this.width = 160;
		this.height = 144;
		this.canvasFallbackHappened = true;
		this.drawContext = new BMPCanvas(this.canvasAlt, 160, 144, settings[6][0], settings[6][1]);
		this.canvasBuffer = new Object();
		var index = 23040;
		while (index > 0) {
			this.frameBuffer[--index] = 0xF8F8F8;
		}
		this.canvasBuffer.data = this.ArrayPad(92160, 0xF8);
		this.drawContext.putImageData(this.canvasBuffer, 0, 0);
		//Make visible only after the images have been initialized.
		this.canvasAlt.style.visibility = "visible";
		this.canvas.style.visibility = "hidden";			//Speedier layout in some browsers.
	}
}
GameBoyCore.prototype.JoyPadEvent = function (key, down) {
	if (down) {
		this.JoyPad &= 0xFF ^ (1 << key);
		/*if (!this.cGBC) {
			this.interruptsRequested |= 0x10;	//A real GBC doesn't set this!
		}*/
	}
	else {
		this.JoyPad |= (1 << key);
	}
	this.memory[0xFF00] = (this.memory[0xFF00] & 0x30) + ((((this.memory[0xFF00] & 0x20) == 0) ? (this.JoyPad >> 4) : 0xF) & (((this.memory[0xFF00] & 0x10) == 0) ? (this.JoyPad & 0xF) : 0xF));
}
GameBoyCore.prototype.GyroEvent = function (x, y) {
	x *= 100;
	x += 2047;
	this.highX = x >> 8;
	this.lowX = x & 0xFF;
	y *= 100;
	y += 2047;
	this.highY = y >> 8;
	this.lowY = y & 0xFF;
}
GameBoyCore.prototype.initSound = function () {
	this.soundChannelsAllocated = (!settings[1]) ? 2 : 1;
	if (settings[0]) {
		try {
			var parentObj = this;
			this.audioHandle = new XAudioServer(this.soundChannelsAllocated, settings[14], settings[23], settings[24], function (sampleCount) {
				return parentObj.audioUnderRun(sampleCount);
			}, -1);
		}
		catch (error) {
			cout("Audio system cannot run: " + error.message, 2);
			settings[0] = false;
		}
		if (settings[0]) {
			cout("...Audio Channels: " + this.soundChannelsAllocated, 0);
			cout("...Sample Rate: " + settings[14], 0);
			this.initAudioBuffer();
		}
	}
	else {
		//Dummy reset the audio (Just in case we turned it off while running and web audio is enabled):
		try {
			this.audioHandle = new XAudioServer(1, 1000, 5000, 20000, function (sampleCount) {
				return [];
			}, -1);
		}
		catch (error) { }
	}
}
GameBoyCore.prototype.initAudioBuffer = function () {
	this.audioIndex = 0;
	this.sampleSize = Math.floor(settings[14] / 1000 * settings[20]);
	cout("...Samples Per VBlank (Per Channel): " + this.sampleSize, 0);
	this.samplesOut = this.sampleSize / this.CPUCyclesPerIteration;
	cout("...Samples Per machine cycle (Per Channel): " + this.samplesOut, 0);
	this.numSamplesTotal = this.sampleSize * this.soundChannelsAllocated;
	this.audioSamples = this.getTypedArray(this.numSamplesTotal, -1, "float32");
	this.audioBackup = this.getTypedArray(this.numSamplesTotal, -1, "float32");
	//Noise Sample Table:
	var noiseSampleTable = this.getTypedArray(0x80000, 0, "float32");
	this.noiseSampleTable = noiseSampleTable;
	var randomFactor = 0;
	for (var index = 0; index < 0x8000; index++) {
		//15-bit pseudo-random value:
		randomFactor = Math.round(Math.random() * 0x7FFF) / 0xFFFE;	//Get the pseudo-random value.
		noiseSampleTable[0x08000 | index] = randomFactor * 0x1 / 0xF;
		noiseSampleTable[0x10000 | index] = randomFactor * 0x2 / 0xF;
		noiseSampleTable[0x18000 | index] = randomFactor * 0x3 / 0xF;
		noiseSampleTable[0x20000 | index] = randomFactor * 0x4 / 0xF;
		noiseSampleTable[0x28000 | index] = randomFactor * 0x5 / 0xF;
		noiseSampleTable[0x30000 | index] = randomFactor * 0x6 / 0xF;
		noiseSampleTable[0x38000 | index] = randomFactor * 0x7 / 0xF;
		noiseSampleTable[0x40000 | index] = randomFactor * 0x8 / 0xF;
		noiseSampleTable[0x48000 | index] = randomFactor * 0x9 / 0xF;
		noiseSampleTable[0x50000 | index] = randomFactor * 0xA / 0xF;
		noiseSampleTable[0x58000 | index] = randomFactor * 0xB / 0xF;
		noiseSampleTable[0x60000 | index] = randomFactor * 0xC / 0xF;
		noiseSampleTable[0x68000 | index] = randomFactor * 0xD / 0xF;
		noiseSampleTable[0x70000 | index] = randomFactor * 0xE / 0xF;
		noiseSampleTable[0x78000 | index] = randomFactor;
	}
}
GameBoyCore.prototype.audioUnderRun = function (samplesRequested) {
	samplesRequested = Math.min(samplesRequested, this.numSamplesTotal - this.soundChannelsAllocated);
		//We need more audio samples since we went below our set low limit:
		var neededSamples = samplesRequested - this.audioIndex;
		if (neededSamples > 0) {
			var tempBuffer = [];
			//Use any existing samples and then create some:
			if (this.audioIndex > 0) {
				tempBuffer = this.audioBufferSlice(this.audioIndex);
				this.audioIndex = 0;
			}
			this.generateAudioSafe(neededSamples / this.soundChannelsAllocated);
			var oldlength = tempBuffer.length;
			var newlength = oldlength + this.audioIndex;
			var tempBuffer2 = this.getTypedArray(newlength, 0, "float32");
			for (var index = 0; index < oldlength; index++) {
				tempBuffer2[index] = tempBuffer[index];
			}
			for (var index2 = 0; index < newlength; index++) {
				tempBuffer2[index] = this.currentBuffer[index2++];
			}
			this.audioIndex = 0;
			return tempBuffer2;
		}
		else if (neededSamples == 0) {
			//Use the overflow buffer's existing samples:
			this.audioIndex = 0;
			return this.currentBuffer;
		}
		else {
			//Use the overflow buffer's existing samples:
			var tempBuffer = this.audioBufferSlice(samplesRequested);
			neededSamples = this.audioIndex - samplesRequested;
			while (--neededSamples >= 0) {
				//Move over the remaining samples to their new positions:
				this.currentBuffer[neededSamples] = this.currentBuffer[samplesRequested + neededSamples];
			}
			this.audioIndex -= samplesRequested;
			return tempBuffer;
		}
}
GameBoyCore.prototype.playAudio = function () {
	if (settings[0]) {
		if (!this.audioOverflow && this.audioIndex < this.numSamplesTotal) {
			//Make sure we don't under-run the sample generation (Round off the CPU-timed audio generation):
			this.generateAudio((this.numSamplesTotal - this.audioIndex) / this.soundChannelsAllocated);
		}
		this.audioHandle.writeAudio((this.audioOverflow != this.usingBackupAsMain) ? this.audioBackup : this.audioSamples);
	}
}
GameBoyCore.prototype.initializeAudioStartState = function () {
	this.channel1adjustedFrequencyPrep = 0;
	this.channel1lastSampleLookup = 0;
	this.channel1adjustedDuty = 0.5;
	this.channel1totalLength = 0;
	this.channel1envelopeVolume = 0;
	this.channel1currentVolume = 0;
	this.channel1envelopeType = false;
	this.channel1envelopeSweeps = 0;
	this.channel1consecutive = true;
	this.channel1frequency = 0;
	this.channel1volumeEnvTime = 0;
	this.channel1volumeEnvTimeLast = 0;
	this.channel1lastTotalLength = 0;
	this.channel1timeSweep = 0;
	this.channel1lastTimeSweep = 0;
	this.channel1numSweep = 0;
	this.channel1frequencySweepDivider = 0;
	this.channel1decreaseSweep = false;
	this.channel2adjustedFrequencyPrep = 0;
	this.channel2lastSampleLookup = 0;
	this.channel2adjustedDuty = 0.5;
	this.channel2totalLength = 0;
	this.channel2envelopeVolume = 0;
	this.channel2currentVolume = 0;
	this.channel2envelopeType = false;
	this.channel2envelopeSweeps = 0;
	this.channel2consecutive = true;
	this.channel2frequency = 0;
	this.channel2volumeEnvTime = 0;
	this.channel2volumeEnvTimeLast = 0;
	this.channel2lastTotalLength = 0;
	this.channel3canPlay = false;
	this.channel3totalLength = 0;
	this.channel3lastTotalLength = 0;
	this.channel3patternType = -20;
	this.channel3frequency = 0;
	this.channel3consecutive = true;
	this.channel3PCM = this.getTypedArray(0x60, 0, "float32");
	this.channel3adjustedFrequencyPrep = 0x20000 / settings[14];
	this.channel4adjustedFrequencyPrep = 0;
	this.channel4lastSampleLookup = 0;				//Keeps track of the audio timing.
	this.channel4totalLength = 0;
	this.channel4envelopeVolume = 0;
	this.channel4currentVolume = 0;
	this.channel4envelopeType = false;
	this.channel4envelopeSweeps = 0;
	this.channel4consecutive = true;
	this.channel4volumeEnvTime = 0;
	this.channel4volumeEnvTimeLast = 0;
	this.channel4lastTotalLength = 0;
	this.noiseTableLength = 0x8000;
}
//Below are the audio generation functions timed against the CPU:
GameBoyCore.prototype.generateAudio = function (numSamples) {
	if (settings[0]) {
		if (this.soundMasterEnabled) {
			if (settings[1]) {						//Split Mono & Stereo into two, to avoid this if statement every iteration of the loop.
				while (--numSamples >= 0) {
					//MONO
					this.channel1Compute();
					this.channel2Compute();
					this.channel3Compute();
					this.channel4Compute();
					this.currentBuffer[this.audioIndex++] = this.currentSampleRight * this.VinRightChannelMasterVolume - 1;
					if (this.audioIndex == this.numSamplesTotal) {
						this.audioIndex = 0;
						if (this.usingBackupAsMain) {
							this.currentBuffer = this.audioSamples;
							this.usingBackupAsMain = false;
						}
						else {
							this.currentBuffer = this.audioBackup;
							this.usingBackupAsMain = true;
						}
						this.audioOverflow = true;
					}
				}
			}
			else {
				while (--numSamples >= 0) {
					//STEREO
					this.channel1Compute();
					this.channel2Compute();
					this.channel3Compute();
					this.channel4Compute();
					this.currentBuffer[this.audioIndex++] = this.currentSampleLeft * this.VinLeftChannelMasterVolume - 1;
					this.currentBuffer[this.audioIndex++] = this.currentSampleRight * this.VinRightChannelMasterVolume - 1;
					if (this.audioIndex == this.numSamplesTotal) {
						this.audioIndex = 0;
						if (this.usingBackupAsMain) {
							this.currentBuffer = this.audioSamples;
							this.usingBackupAsMain = false;
						}
						else {
							this.currentBuffer = this.audioBackup;
							this.usingBackupAsMain = true;
						}
						this.audioOverflow = true;
					}
				}
			}
		}
		else {
			//SILENT OUTPUT:
			if (settings[1]) {
				while (--numSamples >= 0) {
					//MONO
					this.currentBuffer[this.audioIndex++] = -1;
					if (this.audioIndex == this.numSamplesTotal) {
						this.audioIndex = 0;
						if (this.usingBackupAsMain) {
							this.currentBuffer = this.audioSamples;
							this.usingBackupAsMain = false;
						}
						else {
							this.currentBuffer = this.audioBackup;
							this.usingBackupAsMain = true;
						}
						this.audioOverflow = true;
					}
				}
			}
			else {
				while (--numSamples >= 0) {
					//STEREO
					this.currentBuffer[this.audioIndex++] = this.currentBuffer[this.audioIndex++] = -1;
					if (this.audioIndex == this.numSamplesTotal) {
						this.audioIndex = 0;
						if (this.usingBackupAsMain) {
							this.currentBuffer = this.audioSamples;
							this.usingBackupAsMain = false;
						}
						else {
							this.currentBuffer = this.audioBackup;
							this.usingBackupAsMain = true;
						}
						this.audioOverflow = true;
					}
				}
			}
		}
	}
}
GameBoyCore.prototype.audioJIT = function () {
	//Audio Sample Generation Timing:
	var amount = this.audioTicks * this.samplesOut;
	var actual = amount | 0;
	this.rollover += amount - actual;
	if (this.rollover >= 1) {
		this.rollover--;
		actual++;
	}
	this.generateAudio(actual);
	this.audioTicks = 0;
}
GameBoyCore.prototype.channel1Compute = function () {
	if ((this.channel1consecutive || this.channel1totalLength > 0) && this.channel1frequency <= 0x7FF) {
		if (this.channel1lastSampleLookup <= this.channel1adjustedDuty) {
			this.currentSampleLeft = (this.leftChannel[0]) ? this.channel1currentVolume : 0;
			this.currentSampleRight = (this.rightChannel[0]) ? this.channel1currentVolume : 0;
		}
		else {
			this.currentSampleLeft = this.currentSampleRight = 0;
		}
		if (this.channel1numSweep > 0) {
			if (--this.channel1timeSweep == 0) {
				this.channel1numSweep--;
				if (this.channel1decreaseSweep) {
					this.channel1frequency -= this.channel1frequency / this.channel1frequencySweepDivider;
				}
				else {
					this.channel1frequency += this.channel1frequency / this.channel1frequencySweepDivider;
					if (this.channel1frequency > 0x7FF) {
						this.memory[0xFF26] &= 0xFE;	//Channel #1 On Flag Off
					}
				}
				this.channel1timeSweep = this.channel1lastTimeSweep;
				//Pre-calculate the frequency computation outside the waveform generator for speed:
				this.channel1adjustedFrequencyPrep = this.preChewedAudioComputationMultiplier / (0x800 - this.channel1frequency);
			}
		}
		if (this.channel1envelopeSweeps > 0) {
			if (this.channel1volumeEnvTime > 0) {
				this.channel1volumeEnvTime--;
			}
			else {
				if (!this.channel1envelopeType) {
					if (this.channel1envelopeVolume > 0) {
						this.channel1currentVolume = --this.channel1envelopeVolume / 0x1E;
						this.channel1volumeEnvTime = this.channel1volumeEnvTimeLast;
					}
				}
				else if (this.channel1envelopeVolume < 0xF) {
					this.channel1currentVolume = ++this.channel1envelopeVolume / 0x1E;
					this.channel1volumeEnvTime = this.channel1volumeEnvTimeLast;
				}
			}
		}
		if (this.channel1totalLength > 0) {
			this.channel1totalLength--;
			if (this.channel1totalLength <= 0) {
				this.memory[0xFF26] &= 0xFE;	//Channel #1 On Flag Off
			}
		}
		this.channel1lastSampleLookup += this.channel1adjustedFrequencyPrep;
		while (this.channel1lastSampleLookup >= 1) {
			this.channel1lastSampleLookup -= 1;
		}
	}
	else {
		this.currentSampleLeft = this.currentSampleRight = 0;
	}
}
GameBoyCore.prototype.channel2Compute = function () {
	if (this.channel2consecutive || this.channel2totalLength > 0) {
		if (this.channel2lastSampleLookup <= this.channel2adjustedDuty) {
			if (this.leftChannel[1]) {
				this.currentSampleLeft += this.channel2currentVolume;
			}
			if (this.rightChannel[1]) {
				this.currentSampleRight += this.channel2currentVolume;
			}
		}
		if (this.channel2envelopeSweeps > 0) {
			if (this.channel2volumeEnvTime > 0) {
				this.channel2volumeEnvTime--;
			}
			else {
				if (!this.channel2envelopeType) {
					if (this.channel2envelopeVolume > 0) {
						this.channel2currentVolume = --this.channel2envelopeVolume / 0x1E;
						this.channel2volumeEnvTime = this.channel2volumeEnvTimeLast;
					}
				}
				else if (this.channel2envelopeVolume < 0xF) {
					this.channel2currentVolume = ++this.channel2envelopeVolume / 0x1E;
					this.channel2volumeEnvTime = this.channel2volumeEnvTimeLast;
				}
			}
		}
		if (this.channel2totalLength > 0) {
			this.channel2totalLength--;
			if (this.channel2totalLength <= 0) {
				this.memory[0xFF26] &= 0xFD;	//Channel #2 On Flag Off
			}
		}
		this.channel2lastSampleLookup += this.channel2adjustedFrequencyPrep;
		while (this.channel2lastSampleLookup >= 1) {
			this.channel2lastSampleLookup -= 1;
		}
	}
}
GameBoyCore.prototype.channel3Compute = function () {
	if (this.channel3canPlay && (this.channel3consecutive || this.channel3totalLength > 0)) {
		if (this.channel3patternType > -20) {
			var PCMSample = this.channel3PCM[this.channel3Tracker | this.channel3patternType];
			if (this.leftChannel[2]) {
				this.currentSampleLeft += PCMSample;
			}
			if (this.rightChannel[2]) {
				this.currentSampleRight += PCMSample;
			}
		}
		this.channel3Tracker += this.channel3adjustedFrequencyPrep;
		if (this.channel3Tracker >= 0x20) {
			this.channel3Tracker -= 0x20;
		}
		if (this.channel3totalLength > 0) {
			this.channel3totalLength--;
			if (this.channel3totalLength <= 0) {
				this.memory[0xFF26] &= 0xFB;	//Channel #3 On Flag Off
			}
		}
	}
}
GameBoyCore.prototype.channel4Compute = function () {
	if (this.channel4consecutive || this.channel4totalLength > 0) {
		var duty = this.noiseSampleTable[this.channel4currentVolume | this.channel4lastSampleLookup];
		if (this.leftChannel[3]) {
			this.currentSampleLeft += duty;
		}
		if (this.rightChannel[3]) {
			this.currentSampleRight += duty;
		}
		if (this.channel4envelopeSweeps > 0) {
			if (this.channel4volumeEnvTime > 0) {
				this.channel4volumeEnvTime--;
			}
			else {
				if (!this.channel4envelopeType) {
					if (this.channel4envelopeVolume > 0) {
						this.channel4currentVolume = --this.channel4envelopeVolume << 15;
						this.channel4volumeEnvTime = this.channel4volumeEnvTimeLast;
					}
				}
				else if (this.channel4envelopeVolume < 0xF) {
					this.channel4currentVolume = ++this.channel4envelopeVolume << 15;
					this.channel4volumeEnvTime = this.channel4volumeEnvTimeLast;
				}
			}
		}
		if (this.channel4totalLength > 0) {
			this.channel4totalLength--;
			if (this.channel4totalLength <= 0) {
				this.memory[0xFF26] &= 0xF7;	//Channel #4 On Flag Off
			}
		}
		this.channel4lastSampleLookup += this.channel4adjustedFrequencyPrep;
		if (this.channel4lastSampleLookup >= this.noiseTableLength) {
			this.channel4lastSampleLookup -= this.noiseTableLength;
		}
	}
}
//Below are the buffer-underrun protection audio refill functions:
GameBoyCore.prototype.generateAudioSafe = function (numSamples) {
	if (settings[0]) {
		if (this.soundMasterEnabled) {
			if (settings[1]) {						//Split Mono & Stereo into two, to avoid this if statement every iteration of the loop.
				while (--numSamples >= 0) {
					//MONO
					this.audioChannelsComputeSafe();
					this.currentBuffer[this.audioIndex++] = this.currentSampleRight * this.VinRightChannelMasterVolume - 1;
					if (this.audioIndex == this.numSamplesTotal) {
						this.audioIndex = 0;
						if (this.usingBackupAsMain) {
							this.currentBuffer = this.audioSamples;
							this.usingBackupAsMain = false;
						}
						else {
							this.currentBuffer = this.audioBackup;
							this.usingBackupAsMain = true;
						}
						this.audioOverflow = true;
					}
				}
			}
			else {
				while (--numSamples >= 0) {
					//STEREO
					this.audioChannelsComputeSafe();
					this.currentBuffer[this.audioIndex++] = this.currentSampleLeft * this.VinLeftChannelMasterVolume - 1;
					this.currentBuffer[this.audioIndex++] = this.currentSampleRight * this.VinRightChannelMasterVolume - 1;
					if (this.audioIndex == this.numSamplesTotal) {
						this.audioIndex = 0;
						if (this.usingBackupAsMain) {
							this.currentBuffer = this.audioSamples;
							this.usingBackupAsMain = false;
						}
						else {
							this.currentBuffer = this.audioBackup;
							this.usingBackupAsMain = true;
						}
						this.audioOverflow = true;
					}
				}
			}
		}
		else {
			//SILENT OUTPUT:
			if (settings[1]) {
				while (--numSamples >= 0) {
					//MONO
					this.currentBuffer[this.audioIndex++] = -1;
					if (this.audioIndex == this.numSamplesTotal) {
						this.audioIndex = 0;
						if (this.usingBackupAsMain) {
							this.currentBuffer = this.audioSamples;
							this.usingBackupAsMain = false;
						}
						else {
							this.currentBuffer = this.audioBackup;
							this.usingBackupAsMain = true;
						}
						this.audioOverflow = true;
					}
				}
			}
			else {
				while (--numSamples >= 0) {
					//STEREO
					this.currentBuffer[this.audioIndex++] = this.currentBuffer[this.audioIndex++] = -1;
					if (this.audioIndex == this.numSamplesTotal) {
						this.audioIndex = 0;
						if (this.usingBackupAsMain) {
							this.currentBuffer = this.audioSamples;
							this.usingBackupAsMain = false;
						}
						else {
							this.currentBuffer = this.audioBackup;
							this.usingBackupAsMain = true;
						}
						this.audioOverflow = true;
					}
				}
			}
		}
	}
}
GameBoyCore.prototype.audioChannelsComputeSafe = function () {
	//channel 1:
	if ((this.channel1consecutive || this.channel1totalLength > 0) && this.channel1frequency <= 0x7FF) {
		if (this.channel1lastSampleLookup <= this.channel1adjustedDuty) {
			this.currentSampleLeft = (this.leftChannel[0]) ? this.channel1currentVolume : 0;
			this.currentSampleRight = (this.rightChannel[0]) ? this.channel1currentVolume : 0;
		}
		else {
			this.currentSampleLeft = this.currentSampleRight = 0;
		}
		this.channel1lastSampleLookup += this.channel1adjustedFrequencyPrep;
		while (this.channel1lastSampleLookup >= 1) {
			this.channel1lastSampleLookup -= 1;
		}
	}
	else {
		this.currentSampleLeft = this.currentSampleRight = 0;
	}
	//Channel 2:
	if (this.channel2consecutive || this.channel2totalLength > 0) {
		if (this.channel2lastSampleLookup <= this.channel2adjustedDuty) {
			if (this.leftChannel[1]) {
				this.currentSampleLeft += this.channel2currentVolume;
			}
			if (this.rightChannel[1]) {
				this.currentSampleRight += this.channel2currentVolume;
			}
		}
		this.channel2lastSampleLookup += this.channel2adjustedFrequencyPrep;
		while (this.channel2lastSampleLookup >= 1) {
			this.channel2lastSampleLookup -= 1;
		}
	}
	//Channel 3:
	if (this.channel3canPlay && (this.channel3consecutive || this.channel3totalLength > 0)) {
		if (this.channel3patternType > -20) {
			var PCMSample = this.channel3PCM[this.channel3Tracker | this.channel3patternType];
			if (this.leftChannel[2]) {
				this.currentSampleLeft += PCMSample;
			}
			if (this.rightChannel[2]) {
				this.currentSampleRight += PCMSample;
			}
		}
		this.channel3Tracker += this.channel3adjustedFrequencyPrep;
		if (this.channel3Tracker >= 0x20) {
			this.channel3Tracker -= 0x20;
		}
	}
	//Channel 4:
	if (this.channel4consecutive || this.channel4totalLength > 0) {
		var duty = this.noiseSampleTable[this.channel4currentVolume | this.channel4lastSampleLookup];
		if (this.leftChannel[3]) {
			this.currentSampleLeft += duty;
		}
		if (this.rightChannel[3]) {
			this.currentSampleRight += duty;
		}
		this.channel4lastSampleLookup += this.channel4adjustedFrequencyPrep;
		if (this.channel4lastSampleLookup >= this.noiseTableLength) {
			this.channel4lastSampleLookup -= this.noiseTableLength;
		}
	}
}
GameBoyCore.prototype.run = function () {
	//The preprocessing before the actual iteration loop:
	if ((this.stopEmulator & 2) == 0) {
		if ((this.stopEmulator & 1) == 1) {
			this.stopEmulator = 0;
			this.clockUpdate();			//Frame skip and RTC code.
			if (this.halt) {			//Finish the HALT rundown execution.
				this.CPUTicks = 0;
				this.OPCODE[0x76](this);
				this.updateCore();
			}
			this.executeIteration();
		}
		else {		//We can only get here if there was an internal error, but the loop was restarted.
			cout("Iterator restarted a faulted core.", 2);
			pause();
		}
	}
}
GameBoyCore.prototype.executeIteration = function () {
	//Iterate the interpreter loop:
	var op = 0;
	var bitShift = 0;
	var testbit = 1;
	var interrupts = 0;
	while (this.stopEmulator == 0) {
		this.CPUTicks = 0;
		if (this.IME) {
			//Check for IRQ:
			bitShift = 0;
			testbit = 1;
			interrupts = this.interruptsEnabled & this.interruptsRequested;
			do {
				//Check to see if an interrupt is enabled AND requested.
				if ((testbit & interrupts) == testbit) {
					this.IME = false;						//Reset the interrupt enabling.
					this.interruptsRequested -= testbit;	//Reset the interrupt request.
					//Set the stack pointer to the current program counter value:
					this.stackPointer = (this.stackPointer - 1) & 0xFFFF;
					this.memoryWriter[this.stackPointer](this, this.stackPointer, this.programCounter >> 8);
					this.stackPointer = (this.stackPointer - 1) & 0xFFFF;
					this.memoryWriter[this.stackPointer](this, this.stackPointer, this.programCounter & 0xFF);
					//Set the program counter to the interrupt's address:
					this.programCounter = 0x40 | (bitShift << 3);
					//Interrupts have a certain clock cycle length:
					this.CPUTicks += 5;	//People say it's around 5.
					break;	//We only want the highest priority interrupt.
				}
				testbit = 1 << ++bitShift;
			} while (bitShift < 5);
		}
		else if (this.IRQEnableDelay) {
			//Interrupt Arming:
			this.IME = true;
			this.IRQEnableDelay = false;
		}
		//Fetch the current opcode.
		op = this.memoryReader[this.programCounter](this, this.programCounter);
		if (!this.skipPCIncrement) {
			//Increment the program counter to the next instruction:
			this.programCounter = (this.programCounter + 1) & 0xFFFF;
		}
		this.skipPCIncrement = false;
		//Get how many CPU cycles the current op code counts for:
		this.CPUTicks += this.TICKTable[op];
		//Execute the OP code instruction:
		this.OPCODE[op](this);
		//Timing:
		this.updateCore();
	}
}
GameBoyCore.prototype.scanLineMode2 = function () {	//OAM Search Period
	if (this.modeSTAT != 2) {
		if (this.mode2TriggerSTAT) {
			this.interruptsRequested |= 0x2;
		}
		this.STATTracker = 1;
		this.modeSTAT = 2;
	}
}
GameBoyCore.prototype.scanLineMode3 = function () {	//Scan Line Drawing Period
	if (this.modeSTAT != 3) {
		if (this.mode2TriggerSTAT && this.STATTracker == 0) {
			this.interruptsRequested |= 0x2;
		}
		this.STATTracker = 1;
		this.modeSTAT = 3;
	}
}
GameBoyCore.prototype.scanLineMode0 = function () {	//Horizontal Blanking Period
	if (this.modeSTAT != 0) {
		if (this.STATTracker < 4) {
			this.renderScanLine();
			this.STATTracker |= 4
		}
		if (this.LCDTicks >= this.spriteCount) {
			if (this.hdmaRunning) {
				this.executeHDMA();
			}
			if (this.mode0TriggerSTAT || (this.mode2TriggerSTAT && this.STATTracker == 4)) {
				this.interruptsRequested |= 0x2;
			}
			this.STATTracker = 2;
			this.modeSTAT = 0;
		}
	}
}
GameBoyCore.prototype.clocksUntilLYCMatch = function () {
	if (this.memory[0xFF45] != 0) {
		if (this.memory[0xFF45] > this.actualScanLine) {
			return ((114 * (this.memory[0xFF45] - this.actualScanLine)) - this.LCDTicks) * this.multiplier;
		}
		return ((114 * (154 - this.actualScanLine + this.memory[0xFF45])) - this.LCDTicks) * this.multiplier;
	}
	return ((114 * ((this.actualScanLine == 153 && this.memory[0xFF44] == 0) ? 154 : (153 - this.actualScanLine))) + 2 - this.LCDTicks) * this.multiplier;
}
GameBoyCore.prototype.clocksUntilMode0 = function () {
	switch (this.modeSTAT) {
		case 0:
			if (this.actualScanLine == 143) {
				this.updateSpriteCount(0);
				return (this.spriteCount + 1254 - this.LCDTicks) * this.multiplier;
			}
			this.updateSpriteCount(this.actualScanLine + 1);
			return (this.spriteCount + 114 - this.LCDTicks) * this.multiplier;
		case 2:
		case 3:
			this.updateSpriteCount(this.actualScanLine);
			return (this.spriteCount - this.LCDTicks) * this.multiplier;
		case 1:
			this.updateSpriteCount(0);
			return (this.spriteCount + (114 * (154 - this.actualScanLine)) - this.LCDTicks) * this.multiplier;
	}
}
GameBoyCore.prototype.updateSpriteCount = function (line) {
	this.spriteCount = 63;
	if (this.cGBC && this.gfxSpriteShow) {										//Is the window enabled and are we in CGB mode?
		var lineAdjusted = line + 0x10;
		var yoffset = 0;
		var yCap = (this.gfxSpriteDouble) ? 0x10 : 0x8;
		for (var OAMAddress = 0xFE00; OAMAddress < 0xFEA0 && this.spriteCount < 78; OAMAddress += 4) {
			yoffset = lineAdjusted - this.memory[OAMAddress];
			if (yoffset > -1 && yoffset < yCap) {
				this.spriteCount += 1.5;
			}
		}
	}
}
GameBoyCore.prototype.matchLYC = function () {	//LYC Register Compare
	if (this.memory[0xFF44] == this.memory[0xFF45]) {
		this.memory[0xFF41] |= 0x04;
		if (this.LYCMatchTriggerSTAT) {
			this.interruptsRequested |= 0x2;
		}
	} 
	else {
		this.memory[0xFF41] &= 0xFB;
	}
}
GameBoyCore.prototype.updateCore = function () {
	//Update the clocking for the LCD emulation:
	this.LCDTicks += this.CPUTicks / this.multiplier;	//LCD Timing
	this.LCDCONTROL[this.actualScanLine](this);			//Scan Line and STAT Mode Control 
	//Single-speed relative timing for A/V emulation:
	var timedTicks = this.CPUTicks / this.multiplier;	//CPU clocking can be updated from the LCD handling.
	this.audioTicks += timedTicks;						//Audio Timing
	this.emulatorTicks += timedTicks;					//Emulator Timing
	//CPU Timers:
	this.DIVTicks += this.CPUTicks;						//DIV Timing
	if (this.TIMAEnabled) {								//TIMA Timing
		this.timerTicks += this.CPUTicks;
		while (this.timerTicks >= this.TACClocker) {
			this.timerTicks -= this.TACClocker;
			if (this.memory[0xFF05] == 0xFF) {
				this.memory[0xFF05] = this.memory[0xFF06];
				this.interruptsRequested |= 0x4;
			}
			else {
				this.memory[0xFF05]++;
			}
		}
	}
	//End of iteration routine:
	if (this.emulatorTicks >= this.CPUCyclesPerIteration) {
		this.audioJIT();
		this.playAudio();				//Output all the samples built up.
		//Update DIV Alignment (Integer overflow safety):
		this.memory[0xFF04] = (this.memory[0xFF04] + (this.DIVTicks >> 6)) & 0xFF;
		this.DIVTicks &= 0x3F;
		//Update emulator flags:
		this.stopEmulator |= 1;			//End current loop.
		this.emulatorTicks -= this.CPUCyclesPerIteration;
	}
}
GameBoyCore.prototype.initializeLCDController = function () {
	//Display on hanlding:
	var line = 0;
	while (line < 154) {
		if (line < 143) {
			//We're on a normal scan line:
			this.LINECONTROL[line] = function (parentObj) {
				if (parentObj.LCDTicks < 20) {
					parentObj.scanLineMode2();
				}
				else if (parentObj.LCDTicks < 63) {
					parentObj.scanLineMode3();
				}
				else if (parentObj.LCDTicks < 114) {
					parentObj.scanLineMode0();
				}
				else {
					//We're on a new scan line:
					parentObj.LCDTicks -= 114;
					if (parentObj.STATTracker != 2) {
						if (parentObj.STATTracker < 4) {
							parentObj.renderScanLine();
						}
						if (parentObj.hdmaRunning) {
							parentObj.executeHDMA();
						}
						if (parentObj.mode0TriggerSTAT) {
							parentObj.interruptsRequested |= 0x2;
						}
					}
					parentObj.actualScanLine = ++parentObj.memory[0xFF44];
					parentObj.matchLYC();
					parentObj.STATTracker = 0;
					parentObj.scanLineMode2();
					if (parentObj.LCDTicks >= 114) {
						//We need to skip 1 or more scan lines:
						parentObj.renderScanLine();
						parentObj.LINECONTROL[parentObj.actualScanLine](parentObj);	//Scan Line and STAT Mode Control 
					}
				}
			}
		}
		else if (line == 143) {
			//We're on the last visible scan line of the LCD screen:
			this.LINECONTROL[143] = function (parentObj) {
				if (parentObj.LCDTicks < 20) {
					parentObj.scanLineMode2();
				}
				else if (parentObj.LCDTicks < 63) {
					parentObj.scanLineMode3();
				}
				else if (parentObj.LCDTicks < 114) {
					parentObj.scanLineMode0();
				}
				else {
					//Starting V-Blank:
					//Just finished the last visible scan line:
					parentObj.LCDTicks -= 114;
					if (parentObj.mode1TriggerSTAT) {
						parentObj.interruptsRequested |= 0x2;
					}
					if (parentObj.STATTracker != 2) {
						if (parentObj.STATTracker < 4) {
							parentObj.renderScanLine();
						}
						if (parentObj.hdmaRunning) {
							parentObj.executeHDMA();
						}
						if (parentObj.mode0TriggerSTAT) {
							parentObj.interruptsRequested |= 0x2;
						}
					}
					parentObj.actualScanLine = ++parentObj.memory[0xFF44];
					parentObj.matchLYC();
					parentObj.STATTracker = 0;
					parentObj.modeSTAT = 1;
					parentObj.interruptsRequested |= 0x1;
					if (parentObj.drewBlank > 0) {		//LCD off takes at least 2 frames.
						parentObj.drewBlank--;
					}
					else {
						//Draw the frame:
						parentObj.drawToCanvas();
					}
					if (parentObj.LCDTicks >= 114) {
						//We need to skip 1 or more scan lines:
						parentObj.LINECONTROL[parentObj.actualScanLine](parentObj);	//Scan Line and STAT Mode Control 
					}
				}
			}
		}
		else if (line < 153) {
			//In VBlank
			this.LINECONTROL[line] = function (parentObj) {
				if (parentObj.LCDTicks >= 114) {
					//We're on a new scan line:
					parentObj.LCDTicks -= 114;
					parentObj.actualScanLine = ++parentObj.memory[0xFF44];
					parentObj.matchLYC();
					if (parentObj.LCDTicks >= 114) {
						//We need to skip 1 or more scan lines:
						parentObj.LINECONTROL[parentObj.actualScanLine](parentObj);	//Scan Line and STAT Mode Control 
					}
				}
			}
		}
		else {
			//VBlank Ending (We're on the last actual scan line)
			this.LINECONTROL[153] = function (parentObj) {
				if (parentObj.memory[0xFF44] == 153 && parentObj.LCDTicks >= 2) {	//TODO: Double-check to see if 2 is right.
					parentObj.memory[0xFF44] = 0;	//LY register resets to 0 early.
					parentObj.matchLYC();
				}
				if (parentObj.LCDTicks >= 114) {
					//We reset back to the beginning:
					parentObj.LCDTicks -= 114;
					parentObj.actualScanLine = 0;
					parentObj.scanLineMode2();
					if (parentObj.LCDTicks >= 114) {
						//We need to skip 1 or more scan lines:
						parentObj.LINECONTROL[parentObj.actualScanLine](parentObj);	//Scan Line and STAT Mode Control 
					}
				}
			}
		}
		line++;
	}
}
GameBoyCore.prototype.DisplayShowOff = function () {
	if (this.drewBlank == 0) {
		//Draw a blank screen:
		var index = 23040;
		var index2 = this.rgbCount;
		var canvasData = this.canvasBuffer.data;
		if (this.cGBC || (this.usedBootROM && settings[17])) {
			//CGB or DMG-in-CGB colorization:
			while (index > 0) {
				this.frameBuffer[--index] = 0xF8F8F8;
			}
			while (index2 > 0) {
				canvasData[index2 -= 4] = 0xF8;
				canvasData[index2 + 1] = 0xF8;
				canvasData[index2 + 2] = 0xF8;
			}
		}
		else {
			//Classic DMG colorization:
			while (index > 0) {
				this.frameBuffer[--index] = 0xEFFFDE;
			}
			while (index2 > 0) {
				canvasData[index2 -= 4] = 0xEF;
				canvasData[index2 + 1] = 0xFF;
				canvasData[index2 + 2] = 0xDE;
			}
		}
		this.drawContext.putImageData(this.canvasBuffer, 0, 0);
		this.drewBlank = 2;
	}
}
GameBoyCore.prototype.executeHDMA = function () {
	if (this.halt) {
		if ((this.LCDTicks - this.spriteCount) < ((1 / this.multiplier) + 1)) {
			this.DMAWrite(1);
			this.CPUTicks = 1 + ((1 + this.spriteCount) * this.multiplier);
			this.LCDTicks = this.spriteCount + (1 / this.multiplier) + 1;
		}
		else {
			var lcdTicks = this.LCDTicks;
			var clocks = this.CPUTicks;
			this.DMAWrite(1);
			this.LCDTicks = lcdTicks;
			this.CPUTicks = clocks;
		}
	}
	else {
		this.DMAWrite(1);
	}
	if (this.memory[0xFF55] == 0) {
		this.hdmaRunning = false;
		this.memory[0xFF55] = 0xFF;	//Transfer completed ("Hidden last step," since some ROMs don't imply this, but most do).
	}
	else {
		this.memory[0xFF55]--;
	}
}
GameBoyCore.prototype.clockUpdate = function () {
	//We're tying in the same timer for RTC and frame skipping, since we can and this reduces load.
	if (settings[7] || this.cTIMER) {
		var dateObj = new Date();
		var newTime = dateObj.getTime();
		var timeElapsed = newTime - this.lastIteration;	//Get the numnber of milliseconds since this last executed.
		this.lastIteration = newTime;
		if (this.cTIMER && !this.RTCHALT) {
			//Update the MBC3 RTC:
			this.RTCSeconds += timeElapsed / 1000;
			while (this.RTCSeconds >= 60) {	//System can stutter, so the seconds difference can get large, thus the "while".
				this.RTCSeconds -= 60;
				this.RTCMinutes++;
				if (this.RTCMinutes >= 60) {
					this.RTCMinutes -= 60;
					this.RTCHours++;
					if (this.RTCHours >= 24) {
						this.RTCHours -= 24
						this.RTCDays++;
						if (this.RTCDays >= 512) {
							this.RTCDays -= 512;
							this.RTCDayOverFlow = true;
						}
					}
				}
			}
		}
		if (settings[7]) {
			//Auto Frame Skip:
			this.iterations++;
			if (timeElapsed > settings[20] && ((newTime - this.firstIteration) / this.iterations) > (settings[20] + 1 + (settings[20] / this.iterations))) {
				//Did not finish in time...
				if (settings[4] < settings[8]) {
					settings[4]++;
				}
			}
			else if (settings[4] > 0) {
				//We finished on time, decrease frame skipping (throttle to somewhere just below full speed)...
				settings[4]--;
			}
			if (this.iterations > 200) {
				this.iterations = 0;
				this.firstIteration = newTime;
			}
		}
	}
}
GameBoyCore.prototype.drawToCanvas = function () {
	//Draw the frame buffer to the canvas:
	if (settings[4] == 0 || this.frameCount > 0) {
		//Copy and convert the framebuffer data to the CanvasPixelArray format.
		var canvasData = this.canvasBuffer.data;
		var frameBuffer = (settings[21] && this.pixelCount > 0 && this.width != 160 && this.height != 144) ? this.resizeFrameBuffer() : this.frameBuffer;
		var bufferIndex = this.pixelCount;
		var canvasIndex = this.rgbCount;
		while (canvasIndex > 3) {
			canvasData[canvasIndex -= 4] = (frameBuffer[--bufferIndex] >> 16) & 0xFF;		//Red
			canvasData[canvasIndex + 1] = (frameBuffer[bufferIndex] >> 8) & 0xFF;			//Green
			canvasData[canvasIndex + 2] = frameBuffer[bufferIndex] & 0xFF;					//Blue
		}
		//Draw out the CanvasPixelArray data:
		this.drawContext.putImageData(this.canvasBuffer, 0, 0);
		if (settings[4] > 0) {
			//Increment the frameskip counter:
			this.frameCount -= settings[4];
		}
	}
	else {
		//Reset the frameskip counter:
		this.frameCount += settings[12];
	}
}
GameBoyCore.prototype.compileResizeFrameBufferFunction = function () {
	//Attempt to resize the canvas in software instead of in CSS:
	if (settings[13]) {
		//JIT version:
		var column = 0;
		var columnOffset = 0;
		var heightRatio = this.heightRatio;
		var widthRatio = this.widthRatio;
		var height = this.height;
		var width = this.width;
		var compileStringArray = new Array((width * height) + 2);
		var compileStringIndex = 1;
		compileStringArray[0] = "var t = this.scaledFrameBuffer;var o = this.frameBuffer";
		for (var row = 0, rowOffset = 0, pixelOffset = 0; row < height; row++, rowOffset = ((row * heightRatio) | 0) * 160) {
			for (column = 0, columnOffset = 0; column < width; column++, columnOffset += widthRatio) {
				compileStringArray[compileStringIndex++] = "t[" + (pixelOffset++) + "] = o[" + (rowOffset + (columnOffset | 0)) + "]";
			}
		}
		compileStringArray[compileStringIndex] = "return t";
		this.resizeFrameBuffer = new Function(compileStringArray.join(";"));
	}
	else {
		//Runtime resolving version:
		this.resizeFrameBuffer = function () {
			var column = 0;
			var columnOffset = 0;
			var targetFB = this.scaledFrameBuffer;
			var originalFB = this.frameBuffer;
			var heightRatio = this.heightRatio;
			var widthRatio = this.widthRatio;
			var height = this.height;
			var width = this.width;
			for (var row = 0, rowOffset = 0, pixelOffset = 0; row < height; row++, rowOffset = ((row * heightRatio) | 0) * 160) {
				for (column = 0, columnOffset = 0; column < width; column++, columnOffset += widthRatio) {
					targetFB[pixelOffset++] = originalFB[rowOffset + (columnOffset | 0)];
				}
			}
			return targetFB;
		}
	}
}
GameBoyCore.prototype.renderScanLine = function () {
	this.spriteCount = 63;		//Reset the extra clocking for STAT mode 3.
	if (settings[4] == 0 || this.frameCount > 0) {
		this.pixelStart = this.actualScanLine * 160;
		if (this.bgEnabled) {
			this.BGLayerRender(160);
			this.WindowLayerRender(160);
		}
		else {
			var pixelLine = (this.actualScanLine + 1) * 160;
			var defaultColor = (this.cGBC || (this.usedBootROM && settings[17])) ? 0xF8F8F8 : 0xEFFFDE;
			for (var pixelPosition = (this.actualScanLine * 160) + this.currentX; pixelPosition < pixelLine; pixelPosition++) {
				this.frameBuffer[pixelPosition] = defaultColor;
			}
		}
		this.SpriteLayerRender();
	}
	else {
		//Extra clocking of mode3 for CGB still needs to be done, even when we frameskip:
		this.updateSpriteCount(this.actualScanLine);
	}
	this.currentX = 0;
}
GameBoyCore.prototype.renderMidScanLine = function () {
	if (this.actualScanLine < 144 && this.modeSTAT == 3 && (settings[4] == 0 || this.frameCount > 0)) {
		//TODO: Get this accurate:
		if (this.currentX == 0) {
			this.midScanlineOffset = 16 - (this.memory[0xFF43] & 0x7);
		}
		var pixelEnd = Math.floor(160 * Math.max((this.LCDTicks - 23), 0) / 40);
		pixelEnd = Math.min(pixelEnd + this.midScanlineOffset - (pixelEnd % 0x8), 160);
		if (this.bgEnabled) {
			this.pixelStart = this.actualScanLine * 160;
			this.BGLayerRender(pixelEnd);
			this.WindowLayerRender(pixelEnd);
			//TODO: Do midscanline JIT for sprites...
		}
		else {
			var pixelLine = (this.actualScanLine * 160) + pixelEnd;
			var defaultColor = (this.cGBC || (this.usedBootROM && settings[17])) ? 0xF8F8F8 : 0xEFFFDE;
			for (var pixelPosition = (this.actualScanLine * 160) + this.currentX; pixelPosition < pixelLine; pixelPosition++) {
				this.frameBuffer[pixelPosition] = defaultColor;
			}
		}
		this.currentX = pixelEnd;
	}
}
GameBoyCore.prototype.consoleModeAdjust = function () {
	//Reference the correct palette ahead of time...
	this.BGPalette = (this.cGBC) ? this.gbcBGPalette : ((this.usedBootROM && settings[17]) ? this.gbBGColorizedPalette : this.gbBGPalette);
	this.OBJPalette = (this.cGBC) ? this.gbcOBJPalette : ((this.usedBootROM && settings[17]) ? this.gbOBJColorizedPalette : this.gbOBJPalette);
	this.BGLayerRender = (this.cGBC) ? this.BGGBCLayerRender : this.BGGBLayerRender;
	this.WindowLayerRender = (this.cGBC) ? this.WindowGBCLayerRender : this.WindowGBLayerRender;
	this.SpriteLayerRender = (this.cGBC) ? this.SpriteGBCLayerRender : this.SpriteGBLayerRender;
	this.tileCache = this.generateCacheArray((this.cGBC) ? 0xF80 : 0x700);
	this.tileCacheValid = this.getTypedArray((this.cGBC) ? 0xF80 : 0x700, 0, "int8");
	this.BGCHRCurrentBank = (this.currVRAMBank > 0 && this.cGBC) ? this.BGCHRBank2 : this.BGCHRBank1;
	this.LCDCONTROL = (this.LCDisOn) ? this.LINECONTROL : this.DISPLAYOFFCONTROL;
}
GameBoyCore.prototype.getGBCColor = function () {
	//GBC Colorization of DMG ROMs:
	//BG
	for (var counter = 0; counter < 4; counter++) {
		var adjustedIndex = counter << 1;
		//BG
		var value = (this.gbcBGRawPalette[adjustedIndex | 1] << 8) | this.gbcBGRawPalette[adjustedIndex];
		this.cachedBGPaletteConversion[counter] = ((value & 0x1F) << 19) | ((value & 0x3E0) << 6) | ((value & 0x7C00) >> 7);
		//OBJ 1
		value = (this.gbcOBJRawPalette[adjustedIndex | 1] << 8) | this.gbcOBJRawPalette[adjustedIndex];
		this.cachedOBJPaletteConversion[counter] = ((value & 0x1F) << 19) | ((value & 0x3E0) << 6) | ((value & 0x7C00) >> 7);
	}
	//OBJ 2
	for (counter = 4; counter < 8; counter++) {
		adjustedIndex = counter << 1;
		value = (this.gbcOBJRawPalette[adjustedIndex | 1] << 8) | this.gbcOBJRawPalette[adjustedIndex];
		this.cachedOBJPaletteConversion[counter] = ((value & 0x1F) << 19) | ((value & 0x3E0) << 6) | ((value & 0x7C00) >> 7);
	}
}
GameBoyCore.prototype.updateGBBGPalette = function (data) {
	this.gbBGPalette[0] = this.colors[data & 0x03] | 0x2000000;
	this.gbBGPalette[1] = this.colors[(data >> 2) & 0x03];
	this.gbBGPalette[2] = this.colors[(data >> 4) & 0x03];
	this.gbBGPalette[3] = this.colors[data >> 6];
	if (this.usedBootROM) {	//Do palette conversions if we did the GBC bootup:
		//GB colorization:
		this.gbBGColorizedPalette[0] = this.cachedBGPaletteConversion[data & 0x03] | 0x2000000;
		this.gbBGColorizedPalette[1] = this.cachedBGPaletteConversion[(data >> 2) & 0x03];
		this.gbBGColorizedPalette[2] = this.cachedBGPaletteConversion[(data >> 4) & 0x03];
		this.gbBGColorizedPalette[3] = this.cachedBGPaletteConversion[data >> 6];
	}
}
GameBoyCore.prototype.updateGBOBJPalette = function (index, data) {
	this.gbOBJPalette[index] = this.colors[data & 0x03] | 0x2000000;
	this.gbOBJPalette[index | 1] = this.colors[(data >> 2) & 0x03];
	this.gbOBJPalette[index | 2] = this.colors[(data >> 4) & 0x03];
	this.gbOBJPalette[index | 3] = this.colors[data >> 6];
	if (this.usedBootROM) {	//Do palette conversions if we did the GBC bootup:
		//GB colorization:
		this.gbOBJColorizedPalette[index] = this.cachedOBJPaletteConversion[index | (data & 0x03)] | 0x2000000;
		this.gbOBJColorizedPalette[index | 1] = this.cachedOBJPaletteConversion[index | ((data >> 2) & 0x03)];
		this.gbOBJColorizedPalette[index | 2] = this.cachedOBJPaletteConversion[index | ((data >> 4) & 0x03)];
		this.gbOBJColorizedPalette[index | 3] = this.cachedOBJPaletteConversion[index | (data >> 6)];
	}
}
GameBoyCore.prototype.updateGBCBGPalette = function (index, data) {
	if (this.gbcBGRawPalette[index] != data) {
		this.renderMidScanLine();
		//Update the color palette for BG tiles since it changed:
		this.gbcBGRawPalette[index] = data;
		var value = (this.gbcBGRawPalette[index | 1] << 8) | this.gbcBGRawPalette[index & -2];
		if ((index & 0x06) == 0) {
			//Palette 0 (Special tile Priority stuff)
			this.BGPalette[index >> 1] = 0x2000000 | ((value & 0x1F) << 19) | ((value & 0x3E0) << 6) | ((value & 0x7C00) >> 7);
		}
		else {
			//Regular Palettes (No special crap)
			this.BGPalette[index >> 1] = ((value & 0x1F) << 19) | ((value & 0x3E0) << 6) | ((value & 0x7C00) >> 7);
		}
	}
}
GameBoyCore.prototype.updateGBCOBJPalette = function (index, data) {
	if (this.gbcOBJRawPalette[index] != data) {
		this.renderMidScanLine();
		//Update the color palette for OBJ tiles since it changed:
		this.gbcOBJRawPalette[index] = data;
		var value = (this.gbcOBJRawPalette[index | 1] << 8) | this.gbcOBJRawPalette[index & -2];
		if ((index & 0x06) > 0) {
			//Regular Palettes (No special crap)
			this.OBJPalette[index >> 1] = ((value & 0x1F) << 19) | ((value & 0x3E0) << 6) | ((value & 0x7C00) >> 7);
		}
	}
}
GameBoyCore.prototype.BGGBLayerRender = function (pixelEnd) {
	var scrollYAdjusted = (this.memory[0xFF42] + this.actualScanLine) & 0xFF;				//The line of the BG we're at.
	var tileYLine = scrollYAdjusted & 7;
	var tileYDown = this.gfxBackgroundCHRBankPosition | ((scrollYAdjusted & 0xF8) << 2);	//The row of cached tiles we're fetching from.
	var scrollXAdjusted = (this.memory[0xFF43] + this.currentX) & 0xFF;						//The scroll amount of the BG.
	var pixelPosition = this.pixelStart + this.currentX;									//Current pixel we're working on.
	var pixelPositionEnd = this.pixelStart + ((this.gfxWindowDisplay && (this.actualScanLine - this.windowY) >= 0) ? Math.min(this.windowX + this.currentX, pixelEnd) : pixelEnd);	//Make sure we do at most 160 pixels a scanline.
	var tileNumber = (tileYDown + (scrollXAdjusted / 8)) | 0;
	var chrCode = this.BGCHRBank1[tileNumber];
	if (chrCode < this.gfxBackgroundBankOffset) {
		chrCode |= 0x100;
	}
	var tile = ((this.tileCacheValid[chrCode] == 1) ? this.tileCache[chrCode] : this.generateGBTile(chrCode))[tileYLine];
	for (var texel = (scrollXAdjusted % 8); texel < 8 && pixelPosition < pixelPositionEnd && scrollXAdjusted < 0x100; scrollXAdjusted++) {
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
	}
	var scrollXAdjustedAligned = Math.min(pixelPositionEnd - pixelPosition, 0x100 - scrollXAdjusted) >> 3;
	scrollXAdjusted += scrollXAdjustedAligned << 3;
	scrollXAdjustedAligned += tileNumber;
	while (tileNumber < scrollXAdjustedAligned) {
		chrCode = this.BGCHRBank1[++tileNumber];
		if (chrCode < this.gfxBackgroundBankOffset) {
			chrCode |= 0x100;
		}
		tile = ((this.tileCacheValid[chrCode] == 1) ? this.tileCache[chrCode] : this.generateGBTile(chrCode))[tileYLine];
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[0]];
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[1]];
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[2]];
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[3]];
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[4]];
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[5]];
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[6]];
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[7]];
		
	}
	while (pixelPosition < pixelPositionEnd && scrollXAdjusted < 0x100) {
		chrCode = this.BGCHRBank1[++tileNumber];
		if (chrCode < this.gfxBackgroundBankOffset) {
			chrCode |= 0x100;
		}
		tile = ((this.tileCacheValid[chrCode] == 1) ? this.tileCache[chrCode] : this.generateGBTile(chrCode))[tileYLine];
		for (texel = 0; texel < 8 && pixelPosition < pixelPositionEnd && scrollXAdjusted < 0x100; scrollXAdjusted++) {
			this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
		}
	}
	scrollXAdjustedAligned = ((pixelPositionEnd - pixelPosition) >> 3) + tileYDown;
	while (tileYDown < scrollXAdjustedAligned) {
		chrCode = this.BGCHRBank1[tileYDown++];
		if (chrCode < this.gfxBackgroundBankOffset) {
			chrCode |= 0x100;
		}
		tile = ((this.tileCacheValid[chrCode] == 1) ? this.tileCache[chrCode] : this.generateGBTile(chrCode))[tileYLine];
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[0]];
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[1]];
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[2]];
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[3]];
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[4]];
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[5]];
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[6]];
		this.frameBuffer[pixelPosition++] = this.BGPalette[tile[7]];
	}
	while (pixelPosition < pixelPositionEnd) {
		chrCode = this.BGCHRBank1[tileYDown++];
		if (chrCode < this.gfxBackgroundBankOffset) {
			chrCode |= 0x100;
		}
		tile = ((this.tileCacheValid[chrCode] == 1) ? this.tileCache[chrCode] : this.generateGBTile(chrCode))[tileYLine];
		texel = 0;
		while (texel < 8 && pixelPosition < pixelPositionEnd) {
			this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
		}
	}
}
GameBoyCore.prototype.BGGBCLayerRender = function (pixelEnd) {
	var scrollYAdjusted = (this.memory[0xFF42] + this.actualScanLine) & 0xFF;				//The line of the BG we're at.
	var tileYLine = scrollYAdjusted & 7;
	var tileYDown = this.gfxBackgroundCHRBankPosition | ((scrollYAdjusted & 0xF8) << 2);	//The row of cached tiles we're fetching from.
	var scrollXAdjusted = (this.memory[0xFF43] + this.currentX) & 0xFF;						//The scroll amount of the BG.
	var pixelPosition = this.pixelStart + this.currentX;									//Current pixel we're working on.
	var pixelPositionEnd = this.pixelStart + ((this.gfxWindowDisplay && (this.actualScanLine - this.windowY) >= 0) ? Math.min(this.windowX + this.currentX, pixelEnd) : pixelEnd);	//Make sure we do at most 160 pixels a scanline.
	var tileNumber = (tileYDown + (scrollXAdjusted / 8)) | 0;
	var chrCode = this.BGCHRBank1[tileNumber];
	if (chrCode < this.gfxBackgroundBankOffset) {
		chrCode |= 0x100;
	}
	var attrCode = this.BGCHRBank2[tileNumber];
	chrCode |= ((attrCode & 0x08) << 6) | ((attrCode & 0x60) << 5);
	var tile = ((this.tileCacheValid[chrCode] == 1) ? this.tileCache[chrCode] : this.generateGBCTile(attrCode, chrCode))[tileYLine];
	var pixelFlag = (attrCode << 17) & this.BGPriorityEnabled;
	var palette = (attrCode & 0x7) << 2;
	for (var texel = (scrollXAdjusted % 8); texel < 8 && pixelPosition < pixelPositionEnd && scrollXAdjusted < 0x100; scrollXAdjusted++) {
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[texel++]];
	}
	var scrollXAdjustedAligned = Math.min(pixelPositionEnd - pixelPosition, 0x100 - scrollXAdjusted) >> 3;
	scrollXAdjusted += scrollXAdjustedAligned << 3;
	scrollXAdjustedAligned += tileNumber;
	while (tileNumber < scrollXAdjustedAligned) {
		chrCode = this.BGCHRBank1[++tileNumber];
		if (chrCode < this.gfxBackgroundBankOffset) {
			chrCode |= 0x100;
		}
		attrCode = this.BGCHRBank2[tileNumber];
		chrCode |= ((attrCode & 0x08) << 6) | ((attrCode & 0x60) << 5);
		tile = ((this.tileCacheValid[chrCode] == 1) ? this.tileCache[chrCode] : this.generateGBCTile(attrCode, chrCode))[tileYLine];
		pixelFlag = (attrCode << 17) & this.BGPriorityEnabled;
		palette = (attrCode & 0x7) << 2;
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[0]];
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[1]];
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[2]];
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[3]];
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[4]];
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[5]];
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[6]];
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[7]];
	}
	while (pixelPosition < pixelPositionEnd && scrollXAdjusted < 0x100) {
		chrCode = this.BGCHRBank1[++tileNumber];
		if (chrCode < this.gfxBackgroundBankOffset) {
			chrCode |= 0x100;
		}
		attrCode = this.BGCHRBank2[tileNumber];
		chrCode |= ((attrCode & 0x08) << 6) | ((attrCode & 0x60) << 5);
		tile = ((this.tileCacheValid[chrCode] == 1) ? this.tileCache[chrCode] : this.generateGBCTile(attrCode, chrCode))[tileYLine];
		pixelFlag = (attrCode << 17) & this.BGPriorityEnabled;
		palette = (attrCode & 0x7) << 2;
		for (texel = 0; texel < 8 && pixelPosition < pixelPositionEnd && scrollXAdjusted < 0x100; scrollXAdjusted++) {
			this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[texel++]];
		}
	}
	scrollXAdjustedAligned = ((pixelPositionEnd - pixelPosition) >> 3) + tileYDown;
	while (tileYDown < scrollXAdjustedAligned) {
		chrCode = this.BGCHRBank1[tileYDown];
		if (chrCode < this.gfxBackgroundBankOffset) {
			chrCode |= 0x100;
		}
		attrCode = this.BGCHRBank2[tileYDown++];
		chrCode |= ((attrCode & 0x08) << 6) | ((attrCode & 0x60) << 5);
		tile = ((this.tileCacheValid[chrCode] == 1) ? this.tileCache[chrCode] : this.generateGBCTile(attrCode, chrCode))[tileYLine];
		pixelFlag = (attrCode << 17) & this.BGPriorityEnabled;
		palette = (attrCode & 0x7) << 2;
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[0]];
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[1]];
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[2]];
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[3]];
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[4]];
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[5]];
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[6]];
		this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[7]];
	}
	while (pixelPosition < pixelPositionEnd) {
		chrCode = this.BGCHRBank1[tileYDown];
		if (chrCode < this.gfxBackgroundBankOffset) {
			chrCode |= 0x100;
		}
		attrCode = this.BGCHRBank2[tileYDown++];
		chrCode |= ((attrCode & 0x08) << 6) | ((attrCode & 0x60) << 5);
		tile = ((this.tileCacheValid[chrCode] == 1) ? this.tileCache[chrCode] : this.generateGBCTile(attrCode, chrCode))[tileYLine];
		pixelFlag = (attrCode << 17) & this.BGPriorityEnabled;
		palette = (attrCode & 0x7) << 2;
		texel = 0;
		while (texel < 8 && pixelPosition < pixelPositionEnd) {
			this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[texel++]];
		}
	}
}
GameBoyCore.prototype.WindowGBLayerRender = function (pixelEnd) {
	if (this.gfxWindowDisplay) {									//Is the window enabled?
		var scrollYAdjusted = this.actualScanLine - this.windowY;	//The line of the BG we're at.
		if (scrollYAdjusted >= 0) {
			var scrollXAdjusted = this.windowX + this.currentX;		//The scroll amount of the BG.
			var pixelPosition = this.pixelStart + scrollXAdjusted;
			var pixelPositionEnd = this.pixelStart + pixelEnd;
			if (pixelPosition < pixelPositionEnd) {
				var tileYLine = scrollYAdjusted & 7;
				var tileNumber = ((this.gfxWindowCHRBankPosition | ((scrollYAdjusted & 0xF8) << 2)) + (this.currentX / 8)) | 0;
				var chrCode = this.BGCHRBank1[tileNumber];
				if (chrCode < this.gfxBackgroundBankOffset) {
					chrCode |= 0x100;
				}
				tile = ((this.tileCacheValid[chrCode] == 1) ? this.tileCache[chrCode] : this.generateGBTile(chrCode))[tileYLine];
				for (var texel = (this.currentX % 8); texel < 8 && scrollXAdjusted < 160 && pixelPosition < pixelPositionEnd; scrollXAdjusted++) {
					this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
				}
				while (scrollXAdjusted < 160 && pixelPosition < pixelPositionEnd) {
					chrCode = this.BGCHRBank1[++tileNumber];
					if (chrCode < this.gfxBackgroundBankOffset) {
						chrCode |= 0x100;
					}
					tile = ((this.tileCacheValid[chrCode] == 1) ? this.tileCache[chrCode] : this.generateGBTile(chrCode))[tileYLine];
					for (texel = 0; texel < 8 && scrollXAdjusted < 160 && pixelPosition < pixelPositionEnd; scrollXAdjusted++) {
						this.frameBuffer[pixelPosition++] = this.BGPalette[tile[texel++]];
					}
				}
			}
		}
	}
}
GameBoyCore.prototype.WindowGBCLayerRender = function (pixelEnd) {
	if (this.gfxWindowDisplay) {									//Is the window enabled?
		var scrollYAdjusted = this.actualScanLine - this.windowY;	//The line of the BG we're at.
		if (scrollYAdjusted >= 0) {
			var scrollXAdjusted = this.windowX + this.currentX;		//The scroll amount of the BG.
			var pixelPosition = this.pixelStart + scrollXAdjusted;
			var pixelPositionEnd = this.pixelStart + pixelEnd;
			if (pixelPosition < pixelPositionEnd) {
				var tileYLine = scrollYAdjusted & 7;
				var tileNumber = ((this.gfxWindowCHRBankPosition | ((scrollYAdjusted & 0xF8) << 2)) + (this.currentX / 8)) | 0;
				chrCode = this.BGCHRBank1[tileNumber];
				if (chrCode < this.gfxBackgroundBankOffset) {
					chrCode |= 0x100;
				}
				attrCode = this.BGCHRBank2[tileNumber];
				chrCode |= ((attrCode & 0x08) << 6) | ((attrCode & 0x60) << 5);
				tile = ((this.tileCacheValid[chrCode] == 1) ? this.tileCache[chrCode] : this.generateGBCTile(attrCode, chrCode))[tileYLine];
				pixelFlag = (attrCode << 17) & this.BGPriorityEnabled;
				var palette = (attrCode & 0x7) << 2;
				for (var texel = (this.currentX % 8); texel < 8 && scrollXAdjusted < 160 && pixelPosition < pixelPositionEnd; scrollXAdjusted++) {
					this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[texel++]];
				}
				while (scrollXAdjusted < 160 && pixelPosition < pixelPositionEnd) {
					chrCode = this.BGCHRBank1[++tileNumber];
					if (chrCode < this.gfxBackgroundBankOffset) {
						chrCode |= 0x100;
					}
					attrCode = this.BGCHRBank2[tileNumber];
					chrCode |= ((attrCode & 0x08) << 6) | ((attrCode & 0x60) << 5);
					tile = ((this.tileCacheValid[chrCode] == 1) ? this.tileCache[chrCode] : this.generateGBCTile(attrCode, chrCode))[tileYLine];
					pixelFlag = (attrCode << 17) & this.BGPriorityEnabled;
					palette = (attrCode & 0x7) << 2;
					for (texel = 0; texel < 8 && scrollXAdjusted < 160 && pixelPosition < pixelPositionEnd; scrollXAdjusted++) {
						this.frameBuffer[pixelPosition++] = pixelFlag | this.BGPalette[palette | tile[texel++]];
					}
				}
			}
		}
	}
}
GameBoyCore.prototype.SpriteGBLayerRender = function () {
	if (this.gfxSpriteShow) {										//Is the window enabled?
		var lineAdjusted = this.actualScanLine + 0x10;
		var OAMAddress = 0xFE00;
		var yoffset = 0;
		var xcoord = 0;
		var xCounter = 0;
		var xcoord = 0;
		var attrCode = 0;
		var palette = 0;
		var tileNumber = 0;
		var tile = null;
		var data = 0;
		var spriteCount = 0;
		var currentColumn = this.OAMAddresses[0];
		var length = currentColumn.length;
		var currentPixel = 0;
		var spritesOnLine = 0;
		if (!this.gfxSpriteDouble) {
			//Clock up the sprite counter for x-coord 0:
			for (spriteCount = 0; spriteCount < length && spritesOnLine < 10; spriteCount++) {
				yoffset = lineAdjusted - this.memory[currentColumn[spriteCount]];
				if (yoffset > -1 && yoffset < 8) {
					spritesOnLine++;
				}
			}
			//Draw the visible sprites:
			for (var onXCoord = 1; onXCoord < 8; onXCoord++) {
				currentColumn = this.OAMAddresses[onXCoord];
				length = currentColumn.length;
				for (spriteCount = 0; spriteCount < length && spritesOnLine < 10; spriteCount++) {
					OAMAddress = currentColumn[spriteCount];
					yoffset = lineAdjusted - this.memory[OAMAddress];
					if (yoffset > -1 && yoffset < 8) {
						xcoord = xCounter = onXCoord - 8;
						xCounter = Math.max(xCounter, 0);
						attrCode = this.memory[OAMAddress | 3] & 0xF0;
						palette = (attrCode & 0x10) >> 2;
						tileNumber = ((attrCode & 0x60) << 4) | this.memory[OAMAddress | 0x2];
						tile = (this.tileCacheValid[tileNumber] == 1) ? this.tileCache[tileNumber][yoffset] : (this.generateGBCTile(attrCode, tileNumber))[yoffset];
						for (currentPixel = this.pixelStart + xCounter; xCounter < onXCoord; xCounter++, currentPixel++) {
							if (this.frameBuffer[currentPixel] >= 0x2000000) {
								data = tile[xCounter - xcoord];
								if (data > 0) {
									this.frameBuffer[currentPixel] = 0x1000000 | this.OBJPalette[palette | data];
								}
							}
							else if (this.frameBuffer[currentPixel] < 0x1000000) {
								data = tile[xCounter - xcoord];
								if (attrCode < 0x80 && data > 0) {
									this.frameBuffer[currentPixel] = 0x1000000 | this.OBJPalette[palette | data];
								}
							}
						}
						spritesOnLine++;
					}
				}
			}
			for (var onXCoord = 8; onXCoord < 161; onXCoord++) {
				currentColumn = this.OAMAddresses[onXCoord];
				length = currentColumn.length;
				for (spriteCount = 0; spriteCount < length && spritesOnLine < 10; spriteCount++) {
					OAMAddress = currentColumn[spriteCount];
					yoffset = lineAdjusted - this.memory[OAMAddress];
					if (yoffset > -1 && yoffset < 8) {
						attrCode = this.memory[OAMAddress | 3] & 0xF0;
						palette = (attrCode & 0x10) >> 2;
						tileNumber = ((attrCode & 0x60) << 4) | this.memory[OAMAddress | 0x2];
						tile = (this.tileCacheValid[tileNumber] == 1) ? this.tileCache[tileNumber][yoffset] : (this.generateGBCTile(attrCode, tileNumber))[yoffset];
						for (currentPixel = this.pixelStart + onXCoord - 8, xcoord = 0; xcoord < 8; currentPixel++, xcoord++) {
							if (this.frameBuffer[currentPixel] >= 0x2000000) {
								data = tile[xcoord];
								if (data > 0) {
									this.frameBuffer[currentPixel] = 0x1000000 | this.OBJPalette[palette | data];
								}
							}
							else if (this.frameBuffer[currentPixel] < 0x1000000) {
								data = tile[xcoord];
								if (attrCode < 0x80 && data > 0) {
									this.frameBuffer[currentPixel] = 0x1000000 | this.OBJPalette[palette | data];
								}
							}
						}
						spritesOnLine++;
					}
				}
			}
			for (onXCoord = 161; onXCoord < 168; onXCoord++) {
				currentColumn = this.OAMAddresses[onXCoord];
				length = currentColumn.length;
				for (spriteCount = 0; spriteCount < length && spritesOnLine < 10; spriteCount++) {
					OAMAddress = currentColumn[spriteCount];
					yoffset = lineAdjusted - this.memory[OAMAddress];
					if (yoffset > -1 && yoffset < 8) {
						xCounter = onXCoord - 8;
						attrCode = this.memory[OAMAddress | 3] & 0xF0;
						palette = (attrCode & 0x10) >> 2;
						tileNumber = ((attrCode & 0x60) << 4) | this.memory[OAMAddress | 0x2];
						tile = (this.tileCacheValid[tileNumber] == 1) ? this.tileCache[tileNumber][yoffset] : (this.generateGBCTile(attrCode, tileNumber))[yoffset];
						for (currentPixel = this.pixelStart + xCounter, xcoord = 0; xCounter < 160; xCounter++, currentPixel++, xcoord++) {
							if (this.frameBuffer[currentPixel] >= 0x2000000) {
								data = tile[xcoord];
								if (data > 0) {
									this.frameBuffer[currentPixel] = 0x1000000 | this.OBJPalette[palette | data];
								}
							}
							else if (this.frameBuffer[currentPixel] < 0x1000000) {
								data = tile[xcoord];
								if (attrCode < 0x80 && data > 0) {
									this.frameBuffer[currentPixel] = 0x1000000 | this.OBJPalette[palette | data];
								}
							}
						}
						spritesOnLine++;
					}
				}
			}
		}
		else {
			//Clock up the sprite counter for x-coord 0:
			for (spriteCount = 0; spriteCount < length && spritesOnLine < 10; spriteCount++) {
				yoffset = lineAdjusted - this.memory[currentColumn[spriteCount]];
				if (yoffset > -1 && yoffset < 0x10) {
					spritesOnLine++;
				}
			}
			//Draw the visible sprites:
			for (var onXCoord = 1; onXCoord < 8; onXCoord++) {
				currentColumn = this.OAMAddresses[onXCoord];
				length = currentColumn.length;
				for (spriteCount = 0; spriteCount < length && spritesOnLine < 10; spriteCount++) {
					OAMAddress = currentColumn[spriteCount];
					yoffset = lineAdjusted - this.memory[OAMAddress];
					if (yoffset > -1 && yoffset < 0x10) {
						xcoord = xCounter = onXCoord - 8;
						xCounter = Math.max(xCounter, 0);
						attrCode = this.memory[OAMAddress | 0x3] & 0xF0;
						palette = (attrCode & 0x10) >> 2;
						tileNumber = ((attrCode & 0x60) << 4) | (this.memory[OAMAddress | 0x2] & 0xFE);
						if (yoffset < 8) {
							tileNumber |= (((attrCode & 0x40) == 0x40) ? 1 : 0);
						}
						else {
							yoffset -= 8;
							tileNumber |= (((attrCode & 0x40) == 0x40) ? 0 : 1);
						}
						tile = (this.tileCacheValid[tileNumber] == 1) ? this.tileCache[tileNumber][yoffset] : (this.generateGBCTile(attrCode, tileNumber))[yoffset];
						for (currentPixel = this.pixelStart + xCounter; xCounter < onXCoord; xCounter++, currentPixel++) {
							if (this.frameBuffer[currentPixel] >= 0x2000000) {
								data = tile[xCounter - xcoord];
								if (data > 0) {
									this.frameBuffer[currentPixel] = 0x1000000 | this.OBJPalette[palette | data];
								}
							}
							else if (this.frameBuffer[currentPixel] < 0x1000000) {
								data = tile[xCounter - xcoord];
								if (data > 0 && attrCode < 0x80) {
									this.frameBuffer[currentPixel] = 0x1000000 | this.OBJPalette[palette | data];
								}
							}
						}
						spritesOnLine++;
					}
				}
			}
			for (var onXCoord = 8; onXCoord < 161; onXCoord++) {
				currentColumn = this.OAMAddresses[onXCoord];
				length = currentColumn.length;
				for (spriteCount = 0; spriteCount < length && spritesOnLine < 10; spriteCount++) {
					OAMAddress = currentColumn[spriteCount];
					yoffset = lineAdjusted - this.memory[OAMAddress];
					if (yoffset > -1 && yoffset < 0x10) {
						attrCode = this.memory[OAMAddress | 0x3] & 0xF0;
						palette = (attrCode & 0x10) >> 2;
						tileNumber = ((attrCode & 0x60) << 4) | (this.memory[OAMAddress | 0x2] & 0xFE);
						if (yoffset < 8) {
							tileNumber |= (((attrCode & 0x40) == 0x40) ? 1 : 0);
						}
						else {
							yoffset -= 8;
							tileNumber |= (((attrCode & 0x40) == 0x40) ? 0 : 1);
						}
						tile = (this.tileCacheValid[tileNumber] == 1) ? this.tileCache[tileNumber][yoffset] : (this.generateGBCTile(attrCode, tileNumber))[yoffset];
						for (currentPixel = this.pixelStart + onXCoord - 8, xcoord = 0; xcoord < 8; currentPixel++, xcoord++) {
							if (this.frameBuffer[currentPixel] >= 0x2000000) {
								data = tile[xcoord];
								if (data > 0) {
									this.frameBuffer[currentPixel] = 0x1000000 | this.OBJPalette[palette | data];
								}
							}
							else if (this.frameBuffer[currentPixel] < 0x1000000) {
								data = tile[xcoord];
								if (data > 0 && attrCode < 0x80) {
									this.frameBuffer[currentPixel] = 0x1000000 | this.OBJPalette[palette | data];
								}
							}
						}
						spritesOnLine++;
					}
				}
			}
			for (var onXCoord = 161; onXCoord < 168; onXCoord++) {
				currentColumn = this.OAMAddresses[onXCoord];
				length = currentColumn.length;
				for (spriteCount = 0; spriteCount < length && spritesOnLine < 10; spriteCount++) {
					OAMAddress = currentColumn[spriteCount];
					yoffset = lineAdjusted - this.memory[OAMAddress];
					if (yoffset > -1 && yoffset < 0x10) {
						xCounter = onXCoord - 8;
						attrCode = this.memory[OAMAddress | 0x3] & 0xF0;
						palette = (attrCode & 0x10) >> 2;
						tileNumber = ((attrCode & 0x60) << 4) | (this.memory[OAMAddress | 0x2] & 0xFE);
						if (yoffset < 8) {
							tileNumber |= (((attrCode & 0x40) == 0x40) ? 1 : 0);
						}
						else {
							yoffset -= 8;
							tileNumber |= (((attrCode & 0x40) == 0x40) ? 0 : 1);
						}
						tile = (this.tileCacheValid[tileNumber] == 1) ? this.tileCache[tileNumber][yoffset] : (this.generateGBCTile(attrCode, tileNumber))[yoffset];
						for (currentPixel = this.pixelStart + xCounter, xcoord = 0; xCounter < 160; xCounter++, currentPixel++, xcoord++) {
							if (this.frameBuffer[currentPixel] >= 0x2000000) {
								data = tile[xcoord];
								if (data > 0) {
									this.frameBuffer[currentPixel] = 0x1000000 | this.OBJPalette[palette | data];
								}
							}
							else if (this.frameBuffer[currentPixel] < 0x1000000) {
								data = tile[xcoord];
								if (data > 0 && attrCode < 0x80) {
									this.frameBuffer[currentPixel] = 0x1000000 | this.OBJPalette[palette | data];
								}
							}
						}
						spritesOnLine++;
					}
				}
			}
		}
	}
}
GameBoyCore.prototype.SpriteGBCLayerRender = function () {
	if (this.gfxSpriteShow) {										//Is the window enabled?
		var lineAdjusted = this.actualScanLine + 0x10;
		var yoffset = 0;
		var xcoord = 0;
		var endX = 0;
		var xCounter = 0;
		var attrCode = 0;
		var palette = 0;
		var tileNumber = 0;
		var tile = null;
		var data = 0;
		var currentPixel = 0;
		if (!this.gfxSpriteDouble) {
			for (var OAMAddress = 0xFE00; OAMAddress < 0xFEA0 && this.spriteCount < 78; OAMAddress += 4) {
				yoffset = lineAdjusted - this.memory[OAMAddress];
				if (yoffset > -1 && yoffset < 8) {
					xcoord = this.memory[OAMAddress | 1] - 8;
					endX = Math.min(160, xcoord + 8);
					attrCode = this.memory[OAMAddress | 3];
					palette = (attrCode & 7) << 2;
					tileNumber = ((attrCode & 0x08) << 6) | ((attrCode & 0x60) << 5) | this.memory[OAMAddress | 2];
					tile = (this.tileCacheValid[tileNumber] == 1) ? this.tileCache[tileNumber][yoffset] : (this.generateGBCTile(attrCode, tileNumber))[yoffset];
					for (xCounter = Math.max(xcoord, 0), currentPixel = this.pixelStart + xCounter; xCounter < endX; xCounter++, currentPixel++) {
						if (this.frameBuffer[currentPixel] >= 0x2000000) {
							data = tile[xCounter - xcoord];
							if (data > 0) {
								this.frameBuffer[currentPixel] = 0x1000000 | this.OBJPalette[palette | data];
							}
						}
						else if (this.frameBuffer[currentPixel] < 0x1000000) {
							data = tile[xCounter - xcoord];
							if (data > 0 && attrCode < 0x80) {
								this.frameBuffer[currentPixel] = 0x1000000 | this.OBJPalette[palette | data];
							}
						}
					}
					this.spriteCount += 1.5;
				}
			}
		}
		else {
			for (var OAMAddress = 0xFE00; OAMAddress < 0xFEA0 && this.spriteCount < 78; OAMAddress += 4) {
				yoffset = lineAdjusted - this.memory[OAMAddress];
				if (yoffset > -1 && yoffset < 0x10) {
					xcoord = this.memory[OAMAddress | 1] - 8;
					endX = Math.min(160, xcoord + 8);
					attrCode = this.memory[OAMAddress | 3];
					palette = (attrCode & 7) << 2;
					tileNumber = ((attrCode & 0x08) << 6) | ((attrCode & 0x60) << 5) | (this.memory[OAMAddress | 2] & 0xFE);
					if (yoffset < 8) {
						tileNumber |= (((attrCode & 0x40) == 0x40) ? 1 : 0);
					}
					else {
						yoffset -= 8;
						tileNumber |= (((attrCode & 0x40) == 0x40) ? 0 : 1);
					}
					tile = (this.tileCacheValid[tileNumber] == 1) ? this.tileCache[tileNumber][yoffset] : (this.generateGBCTile(attrCode, tileNumber))[yoffset];
					for (xCounter = Math.max(xcoord, 0), currentPixel = this.pixelStart + xCounter; xCounter < endX; xCounter++, currentPixel++) {
						if (this.frameBuffer[currentPixel] >= 0x2000000) {
							data = tile[xCounter - xcoord];
							if (data > 0) {
								this.frameBuffer[currentPixel] = 0x1000000 | this.OBJPalette[palette | data];
							}
						}
						else if (this.frameBuffer[currentPixel] < 0x1000000) {
							data = tile[xCounter - xcoord];
							if (data > 0 && attrCode < 0x80) {
								this.frameBuffer[currentPixel] = 0x1000000 | this.OBJPalette[palette | data];
							}
						}
					}
					this.spriteCount += 1.5;
				}
			}
		}
	}
}
//Generate a tile for the tile cache for DMG's BG+WINDOW:
GameBoyCore.prototype.generateGBTile = function (tile) {
	//Set lookup address to the beginning of the target tile:
	var address = 0x8000 | (tile << 4);
	//Get a reference to the tile:
	var tileBlock = this.tileCache[tile];
	var tileLine = null;
	//Data only from bank 0 with no flipping:
	for (var lineIndex = 0, lineCopy = 0; lineIndex < 8; lineIndex++, address += 2) {
		//Get a reference to the tile line:
		tileLine = tileBlock[lineIndex];
		//Copy the two bytes that make up a tile's line:
		lineCopy = (this.memory[0x1 | address] << 8) | this.memory[address];
		//Each pixel is composed of two bits: MSB is in the second byte, while the LSB is in the first byte.
		//Normal copy (no flip) for a line is in the RTL (right-to-left) format:
		tileLine[7] = ((lineCopy & 0x100) >> 7) | (lineCopy & 0x1);
		tileLine[6] = ((lineCopy & 0x200) >> 8) | ((lineCopy & 0x2) >> 1);
		tileLine[5] = ((lineCopy & 0x400) >> 9) | ((lineCopy & 0x4) >> 2);
		tileLine[4] = ((lineCopy & 0x800) >> 10) | ((lineCopy & 0x8) >> 3);
		tileLine[3] = ((lineCopy & 0x1000) >> 11) | ((lineCopy & 0x10) >> 4);
		tileLine[2] = ((lineCopy & 0x2000) >> 12) | ((lineCopy & 0x20) >> 5);
		tileLine[1] = ((lineCopy & 0x4000) >> 13) | ((lineCopy & 0x40) >> 6);
		tileLine[0] = ((lineCopy & 0x8000) >> 14) | ((lineCopy & 0x80) >> 7);
	}
	//Set flag for the tile in the cache to valid:
	this.tileCacheValid[tile] = 1;
	//Return the obtained tile to the rendering path:
	return tileBlock;
}
//Generate a tile for the tile cache for DMG's sprites and all CGB graphics planes:
GameBoyCore.prototype.generateGBCTile = function (map, tile) {
	var address = (tile & 0x1FF) << 4;		//Start address of the tile.
	var tileBlock = this.tileCache[tile];	//Reference to the 8x8 tile.
	var tileLine = null;					//Reference to a line of the cached tile.
	var tileLineWord = this.tileDataCopier;	//Unconverted line data array reference.
	var tileRawLine = 0;					//Unconverted line data.
	if ((map & 8) == 0) {
		//Copy data from bank 0:
		address |= 0x8000;
		for (var index = 0; index < 8; index++) {
			tileLineWord[index] = (this.memory[address | (index << 1) | 1] << 8) | this.memory[address | (index << 1)];
		}
	}
	else {
		//Copy Data from bank 1:
		for (var index = 0; index < 8; index++) {
			tileLineWord[index] = (this.VRAM[address | (index << 1) | 1] << 8) | this.VRAM[address | (index << 1)];
		}
	}
	if ((map & 0x40) == 0x40) {
		//Normal Y:
		var y = 7;
		var yINC = -1;
	}
	else {
		//Flipped Y:
		var y = 0;
		var yINC = 1;
	}
	if ((map & 0x20) == 0) {
		//Normal X:
		for (var lineIndex = 0; lineIndex < 8; lineIndex++, y += yINC) {
			//Get a reference to the tile line:
			tileLine = tileBlock[y];
			tileRawLine = tileLineWord[lineIndex];
			//Each pixel is composed of two bits: MSB is in the second byte, while the LSB is in the first byte.
			tileLine[7] = ((tileRawLine & 0x100) >> 7) | (tileRawLine & 0x1);
			tileLine[6] = ((tileRawLine & 0x200) >> 8) | ((tileRawLine & 0x2) >> 1);
			tileLine[5] = ((tileRawLine & 0x400) >> 9) | ((tileRawLine & 0x4) >> 2);
			tileLine[4] = ((tileRawLine & 0x800) >> 10) | ((tileRawLine & 0x8) >> 3);
			tileLine[3] = ((tileRawLine & 0x1000) >> 11) | ((tileRawLine & 0x10) >> 4);
			tileLine[2] = ((tileRawLine & 0x2000) >> 12) | ((tileRawLine & 0x20) >> 5);
			tileLine[1] = ((tileRawLine & 0x4000) >> 13) | ((tileRawLine & 0x40) >> 6);
			tileLine[0] = ((tileRawLine & 0x8000) >> 14) | ((tileRawLine & 0x80) >> 7);
		}
	}
	else {
		//Flipped X:
		for (var lineIndex = 0; lineIndex < 8; lineIndex++, y += yINC) {
			//Get a reference to the tile line:
			tileLine = tileBlock[y];
			tileRawLine = tileLineWord[lineIndex];
			//Each pixel is composed of two bits: MSB is in the second byte, while the LSB is in the first byte.
			tileLine[0] = ((tileRawLine & 0x100) >> 7) | (tileRawLine & 0x1);
			tileLine[1] = ((tileRawLine & 0x200) >> 8) | ((tileRawLine & 0x2) >> 1);
			tileLine[2] = ((tileRawLine & 0x400) >> 9) | ((tileRawLine & 0x4) >> 2);
			tileLine[3] = ((tileRawLine & 0x800) >> 10) | ((tileRawLine & 0x8) >> 3);
			tileLine[4] = ((tileRawLine & 0x1000) >> 11) | ((tileRawLine & 0x10) >> 4);
			tileLine[5] = ((tileRawLine & 0x2000) >> 12) | ((tileRawLine & 0x20) >> 5);
			tileLine[6] = ((tileRawLine & 0x4000) >> 13) | ((tileRawLine & 0x40) >> 6);
			tileLine[7] = ((tileRawLine & 0x8000) >> 14) | ((tileRawLine & 0x80) >> 7);
		}
	}
	//Set flag for the tile in the cache to valid:
	this.tileCacheValid[tile] = 1;
	//Return the obtained tile to the rendering path:
	return tileBlock;
}
//Memory Reading:
GameBoyCore.prototype.memoryRead = function (address) {
	//Act as a wrapper for reading the returns from the compiled jumps to memory.
	return this.memoryReader[address](this, address);	//This seems to be faster than the usual if/else.
}
GameBoyCore.prototype.memoryReadJumpCompile = function () {
	//Faster in some browsers, since we are doing less conditionals overall by implementing them in advance.
	for (var index = 0x0000; index <= 0xFFFF; index++) {
		if (index < 0x4000) {
			this.memoryReader[index] = this.memoryReadNormal;
		}
		else if (index < 0x8000) {
			this.memoryReader[index] = this.memoryReadROM;
		}
		else if (index < 0x9800) {
			this.memoryReader[index] = (this.cGBC) ? this.VRAMDATAReadCGBCPU : this.VRAMDATAReadDMGCPU;
		}
		else if (index < 0xA000) {
			this.memoryReader[index] = this.VRAMCHRReadCPU;
		}
		else if (index >= 0xA000 && index < 0xC000) {
			if ((this.numRAMBanks == 1 / 16 && index < 0xA200) || this.numRAMBanks >= 1) {
				if (this.cMBC7) {
					this.memoryReader[index] = this.memoryReadMBC7;
				}
				else if (!this.cMBC3) {
					this.memoryReader[index] = this.memoryReadMBC;
				}
				else {
					//MBC3 RTC + RAM:
					this.memoryReader[index] = this.memoryReadMBC3;
				}
			}
			else {
				this.memoryReader[index] = this.memoryReadBAD;
			}
		}
		else if (index >= 0xC000 && index < 0xE000) {
			if (!this.cGBC || index < 0xD000) {
				this.memoryReader[index] = this.memoryReadNormal;
			}
			else {
				this.memoryReader[index] = this.memoryReadGBCMemory;
			}
		}
		else if (index >= 0xE000 && index < 0xFE00) {
			if (!this.cGBC || index < 0xF000) {
				this.memoryReader[index] = this.memoryReadECHONormal;
			}
			else {
				this.memoryReader[index] = this.memoryReadECHOGBCMemory;
			}
		}
		else if (index < 0xFEA0) {
			this.memoryReader[index] = this.memoryReadOAM;
		}
		else if (this.cGBC && index >= 0xFEA0 && index < 0xFF00) {
			this.memoryReader[index] = this.memoryReadNormal;
		}
		else if (index >= 0xFF00) {
			switch (index) {
				case 0xFF00:
					//JOYPAD:
					this.memoryReader[0xFF00] = function (parentObj, address) {
						return 0xC0 | parentObj.memory[0xFF00];	//Top nibble returns as set.
					}
					break;
				case 0xFF01:
					//SC
					this.memoryReader[0xFF01] = function (parentObj, address) {
						return ((parentObj.memory[0xFF02] & 0x1) == 0x1) ? 0xFF : parentObj.memory[0xFF01];
					}
					break;
				case 0xFF02:
					//SB
					if (this.cGBC) {
						this.memoryReader[0xFF02] = function (parentObj, address) {
							return 0x7C | parentObj.memory[0xFF02];
						}
					}
					else {
						this.memoryReader[0xFF02] = function (parentObj, address) {
							return 0x7E | parentObj.memory[0xFF02];
						}
					}
					break;
				case 0xFF04:
					//DIV
					this.memoryReader[0xFF04] = function (parentObj, address) {
						parentObj.memory[0xFF04] = (parentObj.memory[0xFF04] + (parentObj.DIVTicks >> 6)) & 0xFF;
						parentObj.DIVTicks &= 0x3F;
						return parentObj.memory[0xFF04];
						
					}
					break;
				case 0xFF07:
					this.memoryReader[0xFF07] = function (parentObj, address) {
						return 0xF8 | parentObj.memory[0xFF07];
					}
					break;
				case 0xFF0F:
					//IF
					this.memoryReader[0xFF0F] = function (parentObj, address) {
						return 0xE0 | parentObj.interruptsRequested;
					}
					break;
				case 0xFF10:
					this.memoryReader[0xFF10] = function (parentObj, address) {
						return 0x80 | parentObj.memory[0xFF10];
					}
					break;
				case 0xFF11:
					this.memoryReader[0xFF11] = function (parentObj, address) {
						return 0x3F | parentObj.memory[0xFF11];
					}
					break;
				case 0xFF13:
					this.memoryReader[0xFF13] = this.memoryReadBAD;
					break;
				case 0xFF14:
					this.memoryReader[0xFF14] = function (parentObj, address) {
						return 0xBF | parentObj.memory[0xFF14];
					}
					break;
				case 0xFF16:
					this.memoryReader[0xFF16] = function (parentObj, address) {
						return 0x3F | parentObj.memory[0xFF16];
					}
					break;
				case 0xFF18:
					this.memoryReader[0xFF18] = this.memoryReadBAD;
					break;
				case 0xFF19:
					this.memoryReader[0xFF19] = function (parentObj, address) {
						return 0xBF | parentObj.memory[0xFF19];
					}
					break;
				case 0xFF1A:
					this.memoryReader[0xFF1A] = function (parentObj, address) {
						return 0x7F | parentObj.memory[0xFF1A];
					}
					break;
				case 0xFF1B:
					this.memoryReader[0xFF1B] = this.memoryReadBAD;
					break;
				case 0xFF1C:
					this.memoryReader[0xFF1C] = function (parentObj, address) {
						return 0x9F | parentObj.memory[0xFF1C];
					}
					break;
				case 0xFF1D:
					this.memoryReader[0xFF1D] = function (parentObj, address) {
						return 0xFF;
					}
					break;
				case 0xFF1E:
					this.memoryReader[0xFF1E] = function (parentObj, address) {
						return 0xBF | parentObj.memory[0xFF1E];
					}
					break;
				case 0xFF1F:
				case 0xFF20:
					this.memoryReader[index] = this.memoryReadBAD;
					break;
				case 0xFF23:
					this.memoryReader[0xFF23] = function (parentObj, address) {
						return 0xBF | parentObj.memory[0xFF23];
					}
					break;
				case 0xFF26:
					this.memoryReader[0xFF26] = function (parentObj, address) {
						parentObj.audioJIT();
						return 0x70 | parentObj.memory[0xFF26];
					}
					break;
				case 0xFF27:
				case 0xFF28:
				case 0xFF29:
				case 0xFF2A:
				case 0xFF2B:
				case 0xFF2C:
				case 0xFF2D:
				case 0xFF2E:
				case 0xFF2F:
					this.memoryReader[index] = this.memoryReadBAD;
					break;
				case 0xFF30:
				case 0xFF31:
				case 0xFF32:
				case 0xFF33:
				case 0xFF34:
				case 0xFF35:
				case 0xFF36:
				case 0xFF37:
				case 0xFF38:
				case 0xFF39:
				case 0xFF3A:
				case 0xFF3B:
				case 0xFF3C:
				case 0xFF3D:
				case 0xFF3E:
				case 0xFF3F:
					this.memoryReader[index] = function (parentObj, address) {
						return (parentObj.channel3canPlay) ? parentObj.memory[0xFF00 | (parentObj.channel3Tracker / 2)] : parentObj.memory[address];
					}
					break;
				case 0xFF41:
					this.memoryReader[0xFF41] = function (parentObj, address) {
						return 0x80 | parentObj.memory[0xFF41] | parentObj.modeSTAT;
					}
					break;
				case 0xFF44:
					this.memoryReader[0xFF44] = function (parentObj, address) {
						return ((parentObj.LCDisOn) ? parentObj.memory[0xFF44] : 0);
					}
					break;
				case 0xFF4F:
					this.memoryReader[0xFF4F] = function (parentObj, address) {
						return parentObj.currVRAMBank;
					}
					break;
				case 0xFF55:
					if (this.cGBC) {
						this.memoryReader[0xFF55] = function (parentObj, address) {
							if (!parentObj.LCDisOn && parentObj.hdmaRunning) {	//Undocumented behavior alert: HDMA becomes GDMA when LCD is off (Worms Armageddon Fix).
								//DMA
								parentObj.DMAWrite((parentObj.memory[0xFF55] & 0x7F) + 1);
								parentObj.memory[0xFF55] = 0xFF;	//Transfer completed.
								parentObj.hdmaRunning = false;
							}
							return parentObj.memory[0xFF55];
						}
					}
					else {
						this.memoryReader[0xFF55] = this.memoryReadNormal;
					}
					break;
				case 0xFF56:
					if (this.cGBC) {
						this.memoryReader[0xFF56] = function (parentObj, address) {
							//Return IR "not connected" status:
							return 0x3C | ((parentObj.memory[0xFF56] >= 0xC0) ? (0x2 | (parentObj.memory[0xFF56] & 0xC1)) : (parentObj.memory[0xFF56] & 0xC3));
						}
					}
					else {
						this.memoryReader[0xFF56] = this.memoryReadNormal;
					}
					break;
				case 0xFF6C:
					if (this.cGBC) {
						this.memoryReader[0xFF6C] = function (parentObj, address) {
							return 0xFE | parentObj.memory[0xFF6C];
						}
					}
					else {
						this.memoryReader[index] = this.memoryReadBAD;
					}
					break;
				case 0xFF70:
					if (this.cGBC) {
						//SVBK
						this.memoryReader[0xFF70] = function (parentObj, address, data) {
							return 0x40 | parentObj.memory[0xFF70];
						}
					}
					else {
						this.memoryReader[0xFF70] = this.memoryReadBAD;
					}
					break;
				case 0xFF75:
					this.memoryReader[0xFF75] = function (parentObj, address) {
						return 0x8F | parentObj.memory[0xFF75];
					}
					break;
				case 0xFF76:
				case 0xFF77:
					this.memoryReader[index] = function (parentObj, address) {
						return 0;
					}
					break;
				case 0xFFFF:
					//IE
					this.memoryReader[0xFFFF] = function (parentObj, address) {
						return parentObj.interruptsEnabled;
					}
					break;
				default:
					this.memoryReader[index] = this.memoryReadNormal;
			}
		}
		else {
			this.memoryReader[index] = this.memoryReadBAD;
		}
	}
}
GameBoyCore.prototype.memoryReadNormal = function (parentObj, address) {
	return parentObj.memory[address];
}
GameBoyCore.prototype.memoryReadROM = function (parentObj, address) {
	return parentObj.ROM[parentObj.currentROMBank + address];
}
GameBoyCore.prototype.memoryReadMBC = function (parentObj, address) {
	//Switchable RAM
	if (parentObj.MBCRAMBanksEnabled || settings[10]) {
		return parentObj.MBCRam[address + parentObj.currMBCRAMBankPosition];
	}
	//cout("Reading from disabled RAM.", 1);
	return 0xFF;
}
GameBoyCore.prototype.memoryReadMBC7 = function (parentObj, address) {
	//Switchable RAM
	if (parentObj.MBCRAMBanksEnabled || settings[10]) {
		switch (address) {
			case 0xA000:
			case 0xA060:
			case 0xA070:
				return 0;
			case 0xA080:
				//TODO: Gyro Control Register
				return 0;
			case 0xA050:
				//Y High Byte
				return parentObj.highY;
			case 0xA040:
				//Y Low Byte
				return parentObj.lowY;
			case 0xA030:
				//X High Byte
				return parentObj.highX;
			case 0xA020:
				//X Low Byte:
				return parentObj.lowX;
			default:
				return parentObj.MBCRam[address + parentObj.currMBCRAMBankPosition];
		}
	}
	//cout("Reading from disabled RAM.", 1);
	return 0xFF;
}
GameBoyCore.prototype.memoryReadMBC3 = function (parentObj, address) {
	//Switchable RAM
	if (parentObj.MBCRAMBanksEnabled || settings[10]) {
		switch (parentObj.currMBCRAMBank) {
			case 0x00:
			case 0x01:
			case 0x02:
			case 0x03:
				return parentObj.MBCRam[address + parentObj.currMBCRAMBankPosition];
				break;
			case 0x08:
				return parentObj.latchedSeconds;
				break;
			case 0x09:
				return parentObj.latchedMinutes;
				break;
			case 0x0A:
				return parentObj.latchedHours;
				break;
			case 0x0B:
				return parentObj.latchedLDays;
				break;
			case 0x0C:
				return (((parentObj.RTCDayOverFlow) ? 0x80 : 0) + ((parentObj.RTCHALT) ? 0x40 : 0)) + parentObj.latchedHDays;
		}
	}
	//cout("Reading from invalid or disabled RAM.", 1);
	return 0xFF;
}
GameBoyCore.prototype.memoryReadGBCMemory = function (parentObj, address) {
	return parentObj.GBCMemory[address + parentObj.gbcRamBankPosition];
}
GameBoyCore.prototype.memoryReadOAM = function (parentObj, address) {
	return (parentObj.modeSTAT > 1) ?  0xFF : parentObj.memory[address];
}
GameBoyCore.prototype.memoryReadECHOGBCMemory = function (parentObj, address) {
	return parentObj.GBCMemory[address + parentObj.gbcRamBankPositionECHO];
}
GameBoyCore.prototype.memoryReadECHONormal = function (parentObj, address) {
	return parentObj.memory[address - 0x2000];
}
GameBoyCore.prototype.memoryReadBAD = function (parentObj, address) {
	return 0xFF;
}
GameBoyCore.prototype.VRAMDATAReadCGBCPU = function (parentObj, address) {
	//CPU Side Reading The VRAM (Optimized for GameBoy Color)
	return (parentObj.modeSTAT > 2) ? 0xFF : ((parentObj.currVRAMBank == 0) ? parentObj.memory[address] : parentObj.VRAM[address & 0x1FFF]);
}
GameBoyCore.prototype.VRAMDATAReadDMGCPU = function (parentObj, address) {
	//CPU Side Reading The VRAM (Optimized for classic GameBoy)
	return (parentObj.modeSTAT > 2) ? 0xFF : parentObj.memory[address];
}
GameBoyCore.prototype.VRAMCHRReadCPU = function (parentObj, address) {
	//CPU Side Reading the Character Data Map:
	return (parentObj.modeSTAT > 2) ? 0xFF : parentObj.BGCHRCurrentBank[address & 0x7FF];
}
GameBoyCore.prototype.setCurrentMBC1ROMBank = function () {
	//Read the cartridge ROM data from RAM memory:
	switch (this.ROMBank1offs) {
		case 0x00:
		case 0x20:
		case 0x40:
		case 0x60:
			//Bank calls for 0x00, 0x20, 0x40, and 0x60 are really for 0x01, 0x21, 0x41, and 0x61.
			this.currentROMBank = this.ROMBank1offs << 14;
			break;
		default:
			this.currentROMBank = (this.ROMBank1offs - 1) << 14;
	}
	while (this.currentROMBank + 0x4000 >= this.ROM.length) {
		this.currentROMBank -= this.ROM.length;
	}
}
GameBoyCore.prototype.setCurrentMBC2AND3ROMBank = function () {
	//Read the cartridge ROM data from RAM memory:
	//Only map bank 0 to bank 1 here (MBC2 is like MBC1, but can only do 16 banks, so only the bank 0 quirk appears for MBC2):
	this.currentROMBank = Math.max(this.ROMBank1offs - 1, 0) << 14;
	while (this.currentROMBank + 0x4000 >= this.ROM.length) {
		this.currentROMBank -= this.ROM.length;
	}
}
GameBoyCore.prototype.setCurrentMBC5ROMBank = function () {
	//Read the cartridge ROM data from RAM memory:
	this.currentROMBank = (this.ROMBank1offs - 1) << 14;
	while (this.currentROMBank + 0x4000 >= this.ROM.length) {
		this.currentROMBank -= this.ROM.length;
	}
}
//Memory Writing:
GameBoyCore.prototype.memoryWrite = function (address, data) {
	//Act as a wrapper for writing by compiled jumps to specific memory writing functions.
	this.memoryWriter[address](this, address, data);
}
GameBoyCore.prototype.memoryWriteJumpCompile = function () {
	//Faster in some browsers, since we are doing less conditionals overall by implementing them in advance.
	for (var index = 0x0000; index <= 0xFFFF; index++) {
		if (index < 0x8000) {
			if (this.cMBC1) {
				if (index < 0x2000) {
					this.memoryWriter[index] = this.MBCWriteEnable;
				}
				else if (index < 0x4000) {
					this.memoryWriter[index] = this.MBC1WriteROMBank;
				}
				else if (index < 0x6000) {
					this.memoryWriter[index] = this.MBC1WriteRAMBank;
				}
				else {
					this.memoryWriter[index] = this.MBC1WriteType;
				}
			}
			else if (this.cMBC2) {
				if (index < 0x1000) {
					this.memoryWriter[index] = this.MBCWriteEnable;
				}
				else if (index >= 0x2100 && index < 0x2200) {
					this.memoryWriter[index] = this.MBC2WriteROMBank;
				}
				else {
					this.memoryWriter[index] = this.cartIgnoreWrite;
				}
			}
			else if (this.cMBC3) {
				if (index < 0x2000) {
					this.memoryWriter[index] = this.MBCWriteEnable;
				}
				else if (index < 0x4000) {
					this.memoryWriter[index] = this.MBC3WriteROMBank;
				}
				else if (index < 0x6000) {
					this.memoryWriter[index] = this.MBC3WriteRAMBank;
				}
				else {
					this.memoryWriter[index] = this.MBC3WriteRTCLatch;
				}
			}
			else if (this.cMBC5 || this.cRUMBLE || this.cMBC7) {
				if (index < 0x2000) {
					this.memoryWriter[index] = this.MBCWriteEnable;
				}
				else if (index < 0x3000) {
					this.memoryWriter[index] = this.MBC5WriteROMBankLow;
				}
				else if (index < 0x4000) {
					this.memoryWriter[index] = this.MBC5WriteROMBankHigh;
				}
				else if (index < 0x6000) {
					this.memoryWriter[index] = (this.cRUMBLE) ? this.RUMBLEWriteRAMBank : this.MBC5WriteRAMBank;
				}
				else {
					this.memoryWriter[index] = this.cartIgnoreWrite;
				}
			}
			else if (this.cHuC3) {
				if (index < 0x2000) {
					this.memoryWriter[index] = this.MBCWriteEnable;
				}
				else if (index < 0x4000) {
					this.memoryWriter[index] = this.MBC3WriteROMBank;
				}
				else if (index < 0x6000) {
					this.memoryWriter[index] = this.HuC3WriteRAMBank;
				}
				else {
					this.memoryWriter[index] = this.cartIgnoreWrite;
				}
			}
			else {
				this.memoryWriter[index] = this.cartIgnoreWrite;
			}
		}
		else if (index < 0x9000) {
			this.memoryWriter[index] = (this.cGBC) ? this.VRAMGBCDATAWrite : this.VRAMGBDATAWrite;
		}
		else if (index < 0x9800) {
			this.memoryWriter[index] = (this.cGBC) ? this.VRAMGBCDATAWrite : this.VRAMGBDATAUpperWrite;
		}
		else if (index < 0xA000) {
			this.memoryWriter[index] = (this.cGBC) ? this.VRAMGBCCHRMAPWrite : this.VRAMGBCHRMAPWrite;
		}
		else if (index < 0xC000) {
			if ((this.numRAMBanks == 1 / 16 && index < 0xA200) || this.numRAMBanks >= 1) {
				if (!this.cMBC3) {
					this.memoryWriter[index] = this.memoryWriteMBCRAM;
				}
				else {
					//MBC3 RTC + RAM:
					this.memoryWriter[index] = this.memoryWriteMBC3RAM;
				}
			}
			else {
				this.memoryWriter[index] = this.cartIgnoreWrite;
			}
		}
		else if (index < 0xE000) {
			if (this.cGBC && index >= 0xD000) {
				this.memoryWriter[index] = this.memoryWriteGBCRAM;
			}
			else {
				this.memoryWriter[index] = this.memoryWriteNormal;
			}
		}
		else if (index < 0xFE00) {
			if (this.cGBC && index >= 0xF000) {
				this.memoryWriter[index] = this.memoryWriteECHOGBCRAM;
			}
			else {
				this.memoryWriter[index] = this.memoryWriteECHONormal;
			}
		}
		else if (index <= 0xFEA0) {
			this.memoryWriter[index] = (this.cGBC || (index & 3) != 0x1) ? this.memoryWriteGBCOAMRAM : this.memoryWriteGBOAMRAM;
		}
		else if (index < 0xFF00) {
			if (this.cGBC) {											//Only GBC has access to this RAM.
				this.memoryWriter[index] = this.memoryWriteNormal;
			}
			else {
				this.memoryWriter[index] = this.cartIgnoreWrite;
			}
		}
		else {
			//Start the I/O initialization by filling in the slots as normal memory:
			this.memoryWriter[index] = this.memoryWriteNormal;
		}
	}
	this.registerWriteJumpCompile();				//Compile the I/O write functions separately...
}
GameBoyCore.prototype.MBCWriteEnable = function (parentObj, address, data) {
	//MBC RAM Bank Enable/Disable:
	parentObj.MBCRAMBanksEnabled = ((data & 0x0F) == 0x0A);	//If lower nibble is 0x0A, then enable, otherwise disable.
}
GameBoyCore.prototype.MBC1WriteROMBank = function (parentObj, address, data) {
	//MBC1 ROM bank switching:
	parentObj.ROMBank1offs = (parentObj.ROMBank1offs & 0x60) | (data & 0x1F);
	parentObj.setCurrentMBC1ROMBank();
}
GameBoyCore.prototype.MBC1WriteRAMBank = function (parentObj, address, data) {
	//MBC1 RAM bank switching
	if (parentObj.MBC1Mode) {
		//4/32 Mode
		parentObj.currMBCRAMBank = data & 0x03;
		parentObj.currMBCRAMBankPosition = (parentObj.currMBCRAMBank << 13) - 0xA000;
	}
	else {
		//16/8 Mode
		parentObj.ROMBank1offs = ((data & 0x03) << 5) | (parentObj.ROMBank1offs & 0x1F);
		parentObj.setCurrentMBC1ROMBank();
	}
}
GameBoyCore.prototype.MBC1WriteType = function (parentObj, address, data) {
	//MBC1 mode setting:
	parentObj.MBC1Mode = ((data & 0x1) == 0x1);
}
GameBoyCore.prototype.MBC2WriteROMBank = function (parentObj, address, data) {
	//MBC2 ROM bank switching:
	parentObj.ROMBank1offs = data & 0x0F;
	parentObj.setCurrentMBC2AND3ROMBank();
}
GameBoyCore.prototype.MBC3WriteROMBank = function (parentObj, address, data) {
	//MBC3 ROM bank switching:
	parentObj.ROMBank1offs = data & 0x7F;
	parentObj.setCurrentMBC2AND3ROMBank();
}
GameBoyCore.prototype.MBC3WriteRAMBank = function (parentObj, address, data) {
	parentObj.currMBCRAMBank = data;
	if (data < 4) {
		//MBC3 RAM bank switching
		parentObj.currMBCRAMBankPosition = (parentObj.currMBCRAMBank << 13) - 0xA000;
	}
}
GameBoyCore.prototype.MBC3WriteRTCLatch = function (parentObj, address, data) {
	if (data == 0) {
		parentObj.RTCisLatched = false;
	}
	else if (!parentObj.RTCisLatched) {
		//Copy over the current RTC time for reading.
		parentObj.RTCisLatched = true;
		parentObj.latchedSeconds = parentObj.RTCSeconds | 0;
		parentObj.latchedMinutes = parentObj.RTCMinutes;
		parentObj.latchedHours = parentObj.RTCHours;
		parentObj.latchedLDays = (parentObj.RTCDays & 0xFF);
		parentObj.latchedHDays = parentObj.RTCDays >> 8;
	}
}
GameBoyCore.prototype.MBC5WriteROMBankLow = function (parentObj, address, data) {
	//MBC5 ROM bank switching:
	parentObj.ROMBank1offs = (parentObj.ROMBank1offs & 0x100) | data;
	parentObj.setCurrentMBC5ROMBank();
}
GameBoyCore.prototype.MBC5WriteROMBankHigh = function (parentObj, address, data) {
	//MBC5 ROM bank switching (by least significant bit):
	parentObj.ROMBank1offs  = ((data & 0x01) << 8) | (parentObj.ROMBank1offs & 0xFF);
	parentObj.setCurrentMBC5ROMBank();
}
GameBoyCore.prototype.MBC5WriteRAMBank = function (parentObj, address, data) {
	//MBC5 RAM bank switching
	parentObj.currMBCRAMBank = data & 0xF;
	parentObj.currMBCRAMBankPosition = (parentObj.currMBCRAMBank << 13) - 0xA000;
}
GameBoyCore.prototype.RUMBLEWriteRAMBank = function (parentObj, address, data) {
	//MBC5 RAM bank switching
	//Like MBC5, but bit 3 of the lower nibble is used for rumbling and bit 2 is ignored.
	parentObj.currMBCRAMBank = data & 0x03;
	parentObj.currMBCRAMBankPosition = (parentObj.currMBCRAMBank << 13) - 0xA000;
}
GameBoyCore.prototype.HuC3WriteRAMBank = function (parentObj, address, data) {
	//HuC3 RAM bank switching
	parentObj.currMBCRAMBank = data & 0x03;
	parentObj.currMBCRAMBankPosition = (parentObj.currMBCRAMBank << 13) - 0xA000;
}
GameBoyCore.prototype.cartIgnoreWrite = function (parentObj, address, data) {
	//We might have encountered illegal RAM writing or such, so just do nothing...
}
GameBoyCore.prototype.cartIgnoreWriteLog = function (parentObj, address, data) {
	cout("address: " + address + "\r\n data: " + data);
}
GameBoyCore.prototype.memoryWriteNormal = function (parentObj, address, data) {
	parentObj.memory[address] = data;
}
GameBoyCore.prototype.memoryWriteMBCRAM = function (parentObj, address, data) {
	if (parentObj.MBCRAMBanksEnabled || settings[10]) {
		parentObj.MBCRam[address + parentObj.currMBCRAMBankPosition] = data;
	}
}
GameBoyCore.prototype.memoryWriteMBC3RAM = function (parentObj, address, data) {
	if (parentObj.MBCRAMBanksEnabled || settings[10]) {
		switch (parentObj.currMBCRAMBank) {
			case 0x00:
			case 0x01:
			case 0x02:
			case 0x03:
				parentObj.MBCRam[address + parentObj.currMBCRAMBankPosition] = data;
				break;
			case 0x08:
				if (data < 60) {
					parentObj.RTCSeconds = data;
				}
				else {
					cout("(Bank #" + parentObj.currMBCRAMBank + ") RTC write out of range: " + data, 1);
				}
				break;
			case 0x09:
				if (data < 60) {
					parentObj.RTCMinutes = data;
				}
				else {
					cout("(Bank #" + parentObj.currMBCRAMBank + ") RTC write out of range: " + data, 1);
				}
				break;
			case 0x0A:
				if (data < 24) {
					parentObj.RTCHours = data;
				}
				else {
					cout("(Bank #" + parentObj.currMBCRAMBank + ") RTC write out of range: " + data, 1);
				}
				break;
			case 0x0B:
				parentObj.RTCDays = (data & 0xFF) | (parentObj.RTCDays & 0x100);
				break;
			case 0x0C:
				parentObj.RTCDayOverFlow = (data & 0x80) == 0x80;
				parentObj.RTCHalt = (data & 0x40) == 0x40;
				parentObj.RTCDays = ((data & 0x1) << 8) | (parentObj.RTCDays & 0xFF);
				break;
			default:
				cout("Invalid MBC3 bank address selected: " + parentObj.currMBCRAMBank, 0);
		}
	}
}
GameBoyCore.prototype.memoryWriteGBCRAM = function (parentObj, address, data) {
	parentObj.GBCMemory[address + parentObj.gbcRamBankPosition] = data;
}
GameBoyCore.prototype.memoryWriteGBOAMRAM = function (parentObj, address, data) {
	if (parentObj.modeSTAT < 2) {		//OAM RAM cannot be written to in mode 2 & 3
		var oldData = parentObj.memory[address];
		if (oldData != data) {
			//Remove the old position:
			var currentAddress = address & 0xFFFC;
			var length = parentObj.OAMAddresses[oldData].length;
			for (var index = 0; index < length; index++) {
				if (parentObj.OAMAddresses[oldData][index] == currentAddress) {
					parentObj.OAMAddresses[oldData] = (parentObj.OAMAddresses[oldData].slice(0, index)).concat(parentObj.OAMAddresses[oldData].slice(index + 1, length));
					break;
				}
			}
			parentObj.memory[address] = data;
			if (data > 0 && data < 168) {
				//Make sure the stacking is correct if multiple sprites are at the same x-coord:
				var length = parentObj.OAMAddresses[data].length;
				for (var index = 0; index < length; index++) {
					if (parentObj.OAMAddresses[data][index] > currentAddress) {
						var newArray = parentObj.OAMAddresses[data].slice(0, index);
						newArray.push(currentAddress);
						parentObj.OAMAddresses[data] = newArray.concat(parentObj.OAMAddresses[data].slice(index, length));
						return;
					}
				}
			}
			parentObj.OAMAddresses[data].push(currentAddress);
		}
	}
}
GameBoyCore.prototype.memoryWriteGBCOAMRAM = function (parentObj, address, data) {
	if (parentObj.modeSTAT < 2) {		//OAM RAM cannot be written to in mode 2 & 3
		parentObj.memory[address] = data;
	}
}
GameBoyCore.prototype.memoryWriteECHOGBCRAM = function (parentObj, address, data) {
	parentObj.GBCMemory[address + parentObj.gbcRamBankPositionECHO] = data;
}
GameBoyCore.prototype.memoryWriteECHONormal = function (parentObj, address, data) {
	parentObj.memory[address - 0x2000] = data;
}
GameBoyCore.prototype.VRAMGBDATAWrite = function (parentObj, address, data) {
	if (parentObj.modeSTAT < 3) {	//VRAM cannot be written to during mode 3
		if (parentObj.memory[address] != data) {
			parentObj.memory[address] = data;
			var tile = (address & 0x1FF0) >> 4;
			parentObj.tileCacheValid[tile] = 0;
			parentObj.tileCacheValid[0x200 | tile] = 0;
			parentObj.tileCacheValid[0x400 | tile] = 0;
			parentObj.tileCacheValid[0x600 | tile] = 0;
		}
	}
}
GameBoyCore.prototype.VRAMGBDATAUpperWrite = function (parentObj, address, data) {
	if (parentObj.modeSTAT < 3) {	//VRAM cannot be written to during mode 3
		if (parentObj.memory[address] != data) {
			parentObj.memory[address] = data;
			//Invalidate only one tile, since the OAM Attribute table cannot specify > 0xFF:
			parentObj.tileCacheValid[(address & 0x1FF0) >> 4] = 0;
		}
	}
}
GameBoyCore.prototype.VRAMGBCDATAWrite = function (parentObj, address, data) {
	if (parentObj.modeSTAT < 3) {	//VRAM cannot be written to during mode 3
		if (parentObj.currVRAMBank == 0) {
			if (parentObj.memory[address] != data) {
				parentObj.memory[address] = data;
				var tile = (address & 0x1FF0) >> 4;
				parentObj.tileCacheValid[tile] = 0;
				parentObj.tileCacheValid[0x400 | tile] = 0;
				parentObj.tileCacheValid[0x800 | tile] = 0;
				parentObj.tileCacheValid[0xC00 | tile] = 0;
			}
		}
		else {
			if (parentObj.VRAM[address & 0x1FFF] != data) {
				parentObj.VRAM[address & 0x1FFF] = data;
				var tile = (address & 0x1FF0) >> 4;
				parentObj.tileCacheValid[0x200 | tile] = 0;
				parentObj.tileCacheValid[0x600 | tile] = 0;
				parentObj.tileCacheValid[0xA00 | tile] = 0;
				parentObj.tileCacheValid[0xE00 | tile] = 0;
			}
		}
	}
}
GameBoyCore.prototype.VRAMGBCHRMAPWrite = function (parentObj, address, data) {
	if (parentObj.modeSTAT < 3) {	//VRAM cannot be written to during mode 3
		parentObj.BGCHRBank1[address & 0x7FF] = data;
	}
}
GameBoyCore.prototype.VRAMGBCCHRMAPWrite = function (parentObj, address, data) {
	if (parentObj.modeSTAT < 3) {	//VRAM cannot be written to during mode 3
		parentObj.BGCHRCurrentBank[address & 0x7FF] = data;
	}
}
GameBoyCore.prototype.DMAWrite = function (tilesToTransfer) {
	//Clock the CPU for the DMA transfer (CPU is halted during the transfer):
	this.CPUTicks += 1 + (tilesToTransfer * this.multiplier);
	this.LCDTicks += (1 / this.multiplier) + tilesToTransfer;			//LCD Timing Update For DMA.
	//Source address of the transfer:
	var source = (this.memory[0xFF51] << 8) | this.memory[0xFF52];
	//Destination address in the VRAM memory range:
	var destination = (this.memory[0xFF53] << 8) | this.memory[0xFF54];
	//Initialization:
	var tileTarget = 0;
	//Creating some references:
	var tileCacheValid = this.tileCacheValid;
	var memoryReader = this.memoryReader;
	var memory = this.memory;
	//Determining which bank we're working on so we can optimize:
	if (this.currVRAMBank == 0) {
		//DMA transfer for VRAM bank 0:
		do {
			if (destination < 0x1800) {
				tileTarget = destination >> 4;
				tileCacheValid[tileTarget] = tileCacheValid[0x400 | tileTarget] = tileCacheValid[0x800 | tileTarget] = tileCacheValid[0xC00 | tileTarget] = 0;
				memory[0x8000 | destination] = memoryReader[source](this, source++);
				memory[0x8001 | destination] = memoryReader[source](this, source++);
				memory[0x8002 | destination] = memoryReader[source](this, source++);
				memory[0x8003 | destination] = memoryReader[source](this, source++);
				memory[0x8004 | destination] = memoryReader[source](this, source++);
				memory[0x8005 | destination] = memoryReader[source](this, source++);
				memory[0x8006 | destination] = memoryReader[source](this, source++);
				memory[0x8007 | destination] = memoryReader[source](this, source++);
				memory[0x8008 | destination] = memoryReader[source](this, source++);
				memory[0x8009 | destination] = memoryReader[source](this, source++);
				memory[0x800A | destination] = memoryReader[source](this, source++);
				memory[0x800B | destination] = memoryReader[source](this, source++);
				memory[0x800C | destination] = memoryReader[source](this, source++);
				memory[0x800D | destination] = memoryReader[source](this, source++);
				memory[0x800E | destination] = memoryReader[source](this, source++);
				memory[0x800F | destination] = memoryReader[source](this, source++);
				destination += 0x10;
			}
			else {
				destination &= 0x7F0;
				this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank1[destination++] = memoryReader[source](this, source++);
				destination = (destination + 0x1800) & 0x1FF0;
			}
			source &= 0xFFF0;
			tilesToTransfer--;
		} while (tilesToTransfer > 0);
	}
	else {
		var VRAM = this.VRAM;
		//DMA transfer for VRAM bank 1:
		do {
			if (destination < 0x1800) {
				tileTarget = destination >> 4;
				tileCacheValid[0x200 | tileTarget] = tileCacheValid[0x600 | tileTarget] = tileCacheValid[0xA00 | tileTarget] = tileCacheValid[0xE00 | tileTarget] = 0;
				VRAM[destination++] = memoryReader[source](this, source++);
				VRAM[destination++] = memoryReader[source](this, source++);
				VRAM[destination++] = memoryReader[source](this, source++);
				VRAM[destination++] = memoryReader[source](this, source++);
				VRAM[destination++] = memoryReader[source](this, source++);
				VRAM[destination++] = memoryReader[source](this, source++);
				VRAM[destination++] = memoryReader[source](this, source++);
				VRAM[destination++] = memoryReader[source](this, source++);
				VRAM[destination++] = memoryReader[source](this, source++);
				VRAM[destination++] = memoryReader[source](this, source++);
				VRAM[destination++] = memoryReader[source](this, source++);
				VRAM[destination++] = memoryReader[source](this, source++);
				VRAM[destination++] = memoryReader[source](this, source++);
				VRAM[destination++] = memoryReader[source](this, source++);
				VRAM[destination++] = memoryReader[source](this, source++);
				VRAM[destination++] = memoryReader[source](this, source++);
			}
			else {
				destination &= 0x7F0;
				this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
				this.BGCHRBank2[destination++] = memoryReader[source](this, source++);
				destination = (destination + 0x1800) & 0x1FF0;
			}
			source &= 0xFFF0;
			tilesToTransfer--;
		} while (tilesToTransfer > 0);
	}
	//Update the HDMA registers to their next addresses:
	memory[0xFF51] = source >> 8;
	memory[0xFF52] = source & 0xF0;
	memory[0xFF53] = destination >> 8;
	memory[0xFF54] = destination & 0xF0;
}
GameBoyCore.prototype.registerWriteJumpCompile = function () {
	//I/O Registers (GB + GBC):
	//JoyPad
	this.memoryWriter[0xFF00] = function (parentObj, address, data) {
		parentObj.memory[0xFF00] = (data & 0x30) | ((((data & 0x20) == 0) ? (parentObj.JoyPad >> 4) : 0xF) & (((data & 0x10) == 0) ? (parentObj.JoyPad & 0xF) : 0xF));
	}
	//SB (Serial Transfer Data)
	this.memoryWriter[0xFF01] = function (parentObj, address, data) {
		parentObj.memory[0xFF01] = data;
	}
	//SC (Serial Transfer Control Register)
	this.memoryWriter[0xFF02] = function (parentObj, address, data) {
		if (((data & 0x1) == 0x1)) {
			//Internal clock:
			parentObj.memory[0xFF02] = (data & 0x7F);
			parentObj.interruptsRequested |= 0x8;	//Get this time delayed...
		}
		else {
			//External clock:
			parentObj.memory[0xFF02] = data;
			//No connected serial device, so don't trigger interrupt...
		}
	}
	//DIV
	this.memoryWriter[0xFF04] = function (parentObj, address, data) {
		parentObj.DIVTicks &= 0x3F;	//Update DIV for realignment.
		parentObj.memory[0xFF04] = 0;
	}
	//TIMA
	this.memoryWriter[0xFF05] = function (parentObj, address, data) {
		parentObj.memory[0xFF05] = data;
	}
	//TMA
	this.memoryWriter[0xFF06] = function (parentObj, address, data) {
		parentObj.memory[0xFF06] = data;
	}
	//TAC
	this.memoryWriter[0xFF07] = function (parentObj, address, data) {
		parentObj.memory[0xFF07] = data & 0x07;
		parentObj.TIMAEnabled = (data & 0x04) == 0x04;
		parentObj.TACClocker = Math.pow(4, ((data & 0x3) != 0) ? (data & 0x3) : 4);	//TODO: Find a way to not make a conditional in here...
	}
	//IF (Interrupt Request)
	this.memoryWriter[0xFF0F] = function (parentObj, address, data) {
		parentObj.interruptsRequested = data;
	}
	this.memoryWriter[0xFF10] = function (parentObj, address, data) {
		parentObj.audioJIT();
		parentObj.channel1lastTimeSweep = parentObj.channel1timeSweep = (((data & 0x70) >> 4) * parentObj.channel1TimeSweepPreMultiplier) | 0;
		parentObj.channel1numSweep = data & 0x07;
		parentObj.channel1frequencySweepDivider = 1 << parentObj.channel1numSweep;
		parentObj.channel1decreaseSweep = ((data & 0x08) == 0x08);
		parentObj.memory[0xFF10] = data;
	}
	this.memoryWriter[0xFF11] = function (parentObj, address, data) {
		parentObj.audioJIT();
		parentObj.channel1adjustedDuty = parentObj.dutyLookup[data >> 6];
		parentObj.channel1lastTotalLength = parentObj.channel1totalLength = (0x40 - (data & 0x3F)) * parentObj.audioTotalLengthMultiplier;
		parentObj.memory[0xFF11] = data & 0xC0;
	}
	this.memoryWriter[0xFF12] = function (parentObj, address, data) {
		parentObj.audioJIT();
		parentObj.channel1envelopeVolume = data >> 4;
		parentObj.channel1currentVolume = parentObj.channel1envelopeVolume / 0x1E;
		parentObj.channel1envelopeType = ((data & 0x08) == 0x08);
		parentObj.channel1envelopeSweeps = data & 0x7;
		parentObj.channel1volumeEnvTime = parentObj.channel1volumeEnvTimeLast = parentObj.channel1envelopeSweeps * parentObj.volumeEnvelopePreMultiplier;
		parentObj.memory[0xFF12] = data;
	}
	this.memoryWriter[0xFF13] = function (parentObj, address, data) {
		parentObj.audioJIT();
		parentObj.channel1frequency = (parentObj.channel1frequency & 0x700) | data;
		//Pre-calculate the frequency computation outside the waveform generator for speed:
		parentObj.channel1adjustedFrequencyPrep = parentObj.preChewedAudioComputationMultiplier / (0x800 - parentObj.channel1frequency);
		parentObj.memory[0xFF13] = data;
	}
	this.memoryWriter[0xFF14] = function (parentObj, address, data) {
		parentObj.audioJIT();
		if ((data & 0x80) == 0x80) {
			parentObj.channel1envelopeVolume = parentObj.memory[0xFF12] >> 4;
			parentObj.channel1currentVolume = parentObj.channel1envelopeVolume / 0x1E;
			parentObj.channel1volumeEnvTime = parentObj.channel1volumeEnvTimeLast;
			parentObj.channel1totalLength = parentObj.channel1lastTotalLength;
			parentObj.channel1timeSweep = parentObj.channel1lastTimeSweep;
			parentObj.channel1numSweep = parentObj.memory[0xFF10] & 0x07;
			parentObj.channel1frequencySweepDivider = 1 << parentObj.channel1numSweep;
			if ((data & 0x40) == 0x40) {
				parentObj.memory[0xFF26] |= 0x1;
			}
		}
		parentObj.channel1consecutive = ((data & 0x40) == 0x0);
		parentObj.channel1frequency = ((data & 0x7) << 8) | (parentObj.channel1frequency & 0xFF);
		//Pre-calculate the frequency computation outside the waveform generator for speed:
		parentObj.channel1adjustedFrequencyPrep = parentObj.preChewedAudioComputationMultiplier / (0x800 - parentObj.channel1frequency);
		parentObj.memory[0xFF14] = data & 0x40;
	}
	this.memoryWriter[0xFF16] = function (parentObj, address, data) {
		parentObj.audioJIT();
		parentObj.channel2adjustedDuty = parentObj.dutyLookup[data >> 6];
		parentObj.channel2lastTotalLength = parentObj.channel2totalLength = (0x40 - (data & 0x3F)) * parentObj.audioTotalLengthMultiplier;
		parentObj.memory[0xFF16] = data & 0xC0;
	}
	this.memoryWriter[0xFF17] = function (parentObj, address, data) {
		parentObj.audioJIT();
		parentObj.channel2envelopeVolume = data >> 4;
		parentObj.channel2currentVolume = parentObj.channel2envelopeVolume / 0x1E;
		parentObj.channel2envelopeType = ((data & 0x08) == 0x08);
		parentObj.channel2envelopeSweeps = data & 0x7;
		parentObj.channel2volumeEnvTime = parentObj.channel2volumeEnvTimeLast = parentObj.channel2envelopeSweeps * parentObj.volumeEnvelopePreMultiplier;
		parentObj.memory[0xFF17] = data;
	}
	this.memoryWriter[0xFF18] = function (parentObj, address, data) {
		parentObj.audioJIT();
		parentObj.channel2frequency = (parentObj.channel2frequency & 0x700) | data;
		//Pre-calculate the frequency computation outside the waveform generator for speed:
		parentObj.channel2adjustedFrequencyPrep = parentObj.preChewedAudioComputationMultiplier / (0x800 - parentObj.channel2frequency);
		parentObj.memory[0xFF18] = data;
	}
	this.memoryWriter[0xFF19] = function (parentObj, address, data) {
		parentObj.audioJIT();
		if ((data & 0x80) == 0x80) {
			parentObj.channel2envelopeVolume = parentObj.memory[0xFF17] >> 4;
			parentObj.channel2currentVolume = parentObj.channel2envelopeVolume / 0x1E;
			parentObj.channel2volumeEnvTime = parentObj.channel2volumeEnvTimeLast;
			parentObj.channel2totalLength = parentObj.channel2lastTotalLength;
			if ((data & 0x40) == 0x40) {
				parentObj.memory[0xFF26] |= 0x2;
			}
		}
		parentObj.channel2consecutive = ((data & 0x40) == 0x0);
		parentObj.channel2frequency = ((data & 0x7) << 8) | (parentObj.channel2frequency & 0xFF);
		//Pre-calculate the frequency computation outside the waveform generator for speed:
		parentObj.channel2adjustedFrequencyPrep = parentObj.preChewedAudioComputationMultiplier / (0x800 - parentObj.channel2frequency);
		parentObj.memory[0xFF19] = data & 0x40;
	}
	this.memoryWriter[0xFF1A] = function (parentObj, address, data) {
		parentObj.audioJIT();
		if (!parentObj.channel3canPlay && data >= 0x80) {
			parentObj.channel3Tracker = 0;
		}
		parentObj.channel3canPlay = (data >= 0x80);
		if (parentObj.channel3canPlay && (parentObj.memory[0xFF1A] & 0x80) == 0x80) {
			parentObj.channel3totalLength = parentObj.channel3lastTotalLength;
			if (!parentObj.channel3consecutive) {
				parentObj.memory[0xFF26] |= 0x4;
			}
		}
		parentObj.memory[0xFF1A] = data & 0x80;
	}
	this.memoryWriter[0xFF1B] = function (parentObj, address, data) {
		parentObj.audioJIT();
		parentObj.channel3lastTotalLength = parentObj.channel3totalLength = (0x100 - data) * parentObj.audioTotalLengthMultiplier;
		parentObj.memory[0xFF1B] = data;
	}
	this.memoryWriter[0xFF1C] = function (parentObj, address, data) {
		parentObj.audioJIT();
		parentObj.memory[0xFF1C] = data & 0x60;
		parentObj.channel3patternType = parentObj.memory[0xFF1C] - 0x20;
	}
	this.memoryWriter[0xFF1D] = function (parentObj, address, data) {
		parentObj.audioJIT();
		parentObj.channel3frequency = (parentObj.channel3frequency & 0x700) | data;
		parentObj.channel3adjustedFrequencyPrep = parentObj.preChewedWAVEAudioComputationMultiplier / (0x800 - parentObj.channel3frequency);
		parentObj.memory[0xFF1D] = data;
	}
	this.memoryWriter[0xFF1E] = function (parentObj, address, data) {
		parentObj.audioJIT();
		if ((data & 0x80) == 0x80) {
			parentObj.channel3totalLength = parentObj.channel3lastTotalLength;
			parentObj.channel3Tracker = 0;
			if ((data & 0x40) == 0x40) {
				parentObj.memory[0xFF26] |= 0x4;
			}
		}
		parentObj.channel3consecutive = ((data & 0x40) == 0x0);
		parentObj.channel3frequency = ((data & 0x7) << 8) | (parentObj.channel3frequency & 0xFF);
		parentObj.channel3adjustedFrequencyPrep = parentObj.preChewedWAVEAudioComputationMultiplier / (0x800 - parentObj.channel3frequency);
		parentObj.memory[0xFF1E] = data & 0x40;
	}
	this.memoryWriter[0xFF20] = function (parentObj, address, data) {
		parentObj.audioJIT();
		parentObj.channel4lastTotalLength = parentObj.channel4totalLength = (0x40 - (data & 0x3F)) * parentObj.audioTotalLengthMultiplier;
		parentObj.memory[0xFF20] = data | 0xC0;
	}
	this.memoryWriter[0xFF21] = function (parentObj, address, data) {
		parentObj.audioJIT();
		parentObj.channel4envelopeVolume = data >> 4;
		parentObj.channel4currentVolume = parentObj.channel4envelopeVolume << 15;
		parentObj.channel4envelopeType = ((data & 0x08) == 0x08);
		parentObj.channel4envelopeSweeps = data & 0x7;
		parentObj.channel4volumeEnvTime = parentObj.channel4volumeEnvTimeLast = parentObj.channel4envelopeSweeps * parentObj.volumeEnvelopePreMultiplier;
		parentObj.memory[0xFF21] = data;
	}
	this.memoryWriter[0xFF22] = function (parentObj, address, data) {
		parentObj.audioJIT();
		parentObj.channel4adjustedFrequencyPrep = parentObj.whiteNoiseFrequencyPreMultiplier / Math.max(data & 0x7, 0.5) / Math.pow(2, (data >> 4) + 1);
		var bitWidth = (data & 0x8);
		if ((bitWidth == 0x8 && parentObj.noiseTableLength == 0x8000) || (bitWidth == 0 && parentObj.noiseTableLength == 0x80)) {
			parentObj.channel4lastSampleLookup = 0;
			parentObj.noiseTableLength = (bitWidth == 0x8) ? 0x80 : 0x8000;
		}
		parentObj.memory[0xFF22] = data;
	}
	this.memoryWriter[0xFF23] = function (parentObj, address, data) {
		parentObj.audioJIT();
		parentObj.memory[0xFF23] = data;
		parentObj.channel4consecutive = ((data & 0x40) == 0x0);
		if ((data & 0x80) == 0x80) {
			parentObj.channel4lastSampleLookup = 0;
			parentObj.channel4envelopeVolume = parentObj.memory[0xFF21] >> 4;
			parentObj.channel4currentVolume = parentObj.channel4envelopeVolume << 15;
			parentObj.channel4volumeEnvTime = parentObj.channel4volumeEnvTimeLast;
			parentObj.channel4totalLength = parentObj.channel4lastTotalLength;
			if ((data & 0x40) == 0x40) {
				parentObj.memory[0xFF26] |= 0x8;
			}
		}
	}
	this.memoryWriter[0xFF24] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF24] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF24] = data;
			parentObj.VinLeftChannelEnabled = ((data & 0x80) == 0x80);
			parentObj.VinRightChannelEnabled = ((data & 0x8) == 0x8);
			parentObj.VinLeftChannelMasterVolume = (((data >> 4) & 0x07) + 1) / 8;
			parentObj.VinRightChannelMasterVolume = ((data & 0x07) + 1) / 8;
		}
	}
	this.memoryWriter[0xFF25] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF25] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF25] = data;
			parentObj.rightChannel = [(data & 0x01) == 0x01, (data & 0x02) == 0x02, (data & 0x04) == 0x04, (data & 0x08) == 0x08];
			parentObj.leftChannel = [(data & 0x10) == 0x10, (data & 0x20) == 0x20, (data & 0x40) == 0x40, (data & 0x80) == 0x80];
		}
	}
	this.memoryWriter[0xFF26] = function (parentObj, address, data) {
		parentObj.audioJIT();
		var soundEnabled = (data & 0x80);
		parentObj.memory[0xFF26] = soundEnabled | (parentObj.memory[0xFF26] & 0xF);
		/*if (!parentObj.soundMasterEnabled && (soundEnabled == 0x80)) {
			parentObj.memory[0xFF26] = 0;
			parentObj.initializeAudioStartState();
			for (address = 0xFF30; address < 0xFF40; address++) {
				parentObj.memory[address] = 0;
			}
		}*/
		parentObj.soundMasterEnabled = (soundEnabled == 0x80);
	}
	//0xFF27 to 0xFF2F don't do anything...
	this.memoryWriter[0xFF27] = this.cartIgnoreWrite;
	this.memoryWriter[0xFF28] = this.cartIgnoreWrite;
	this.memoryWriter[0xFF29] = this.cartIgnoreWrite;
	this.memoryWriter[0xFF2A] = this.cartIgnoreWrite;
	this.memoryWriter[0xFF2B] = this.cartIgnoreWrite;
	this.memoryWriter[0xFF2C] = this.cartIgnoreWrite;
	this.memoryWriter[0xFF2D] = this.cartIgnoreWrite;
	this.memoryWriter[0xFF2E] = this.cartIgnoreWrite;
	this.memoryWriter[0xFF2F] = this.cartIgnoreWrite;
	//WAVE PCM RAM:
	this.memoryWriter[0xFF30] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF30] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF30] = data;
			parentObj.channel3PCM[0x00] = (data >> 4) / 0x1E;
			parentObj.channel3PCM[0x20] = (data >> 5) / 0x1E;
			parentObj.channel3PCM[0x40] = (data >> 6) / 0x1E;
			parentObj.channel3PCM[0x01] = (data & 0xF) / 0x1E;
			parentObj.channel3PCM[0x21] = (data & 0xE) / 0x3C;
			parentObj.channel3PCM[0x41] = (data & 0xC) / 0x78;
		}
	}
	this.memoryWriter[0xFF31] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF31] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF31] = data;
			parentObj.channel3PCM[0x02] = (data >> 4) / 0x1E;
			parentObj.channel3PCM[0x22] = (data >> 5) / 0x1E;
			parentObj.channel3PCM[0x42] = (data >> 6) / 0x1E;
			parentObj.channel3PCM[0x03] = (data & 0xF) / 0x1E;
			parentObj.channel3PCM[0x23] = (data & 0xE) / 0x3C;
			parentObj.channel3PCM[0x43] = (data & 0xC) / 0x78;
		}
	}
	this.memoryWriter[0xFF32] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF32] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF32] = data;
			parentObj.channel3PCM[0x04] = (data >> 4) / 0x1E;
			parentObj.channel3PCM[0x24] = (data >> 5) / 0x1E;
			parentObj.channel3PCM[0x44] = (data >> 6) / 0x1E;
			parentObj.channel3PCM[0x05] = (data & 0xF) / 0x1E;
			parentObj.channel3PCM[0x25] = (data & 0xE) / 0x3C;
			parentObj.channel3PCM[0x45] = (data & 0xC) / 0x78;
		}
	}
	this.memoryWriter[0xFF33] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF33] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF33] = data;
			parentObj.channel3PCM[0x06] = (data >> 4) / 0x1E;
			parentObj.channel3PCM[0x26] = (data >> 5) / 0x1E;
			parentObj.channel3PCM[0x46] = (data >> 6) / 0x1E;
			parentObj.channel3PCM[0x07] = (data & 0xF) / 0x1E;
			parentObj.channel3PCM[0x27] = (data & 0xE) / 0x3C;
			parentObj.channel3PCM[0x47] = (data & 0xC) / 0x78;
		}
	}
	this.memoryWriter[0xFF34] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF34] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF34] = data;
			parentObj.channel3PCM[0x08] = (data >> 4) / 0x1E;
			parentObj.channel3PCM[0x28] = (data >> 5) / 0x1E;
			parentObj.channel3PCM[0x48] = (data >> 6) / 0x1E;
			parentObj.channel3PCM[0x09] = (data & 0xF) / 0x1E;
			parentObj.channel3PCM[0x29] = (data & 0xE) / 0x3C;
			parentObj.channel3PCM[0x49] = (data & 0xC) / 0x78;
		}
	}
	this.memoryWriter[0xFF35] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF35] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF35] = data;
			parentObj.channel3PCM[0x0A] = (data >> 4) / 0x1E;
			parentObj.channel3PCM[0x2A] = (data >> 5) / 0x1E;
			parentObj.channel3PCM[0x4A] = (data >> 6) / 0x1E;
			parentObj.channel3PCM[0x0B] = (data & 0xF) / 0x1E;
			parentObj.channel3PCM[0x2B] = (data & 0xE) / 0x3C;
			parentObj.channel3PCM[0x4B] = (data & 0xC) / 0x78;
		}
	}
	this.memoryWriter[0xFF36] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF36] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF36] = data;
			parentObj.channel3PCM[0x0C] = (data >> 4) / 0x1E;
			parentObj.channel3PCM[0x2C] = (data >> 5) / 0x1E;
			parentObj.channel3PCM[0x4C] = (data >> 6) / 0x1E;
			parentObj.channel3PCM[0x0D] = (data & 0xF) / 0x1E;
			parentObj.channel3PCM[0x2D] = (data & 0xE) / 0x3C;
			parentObj.channel3PCM[0x4D] = (data & 0xC) / 0x78;
		}
	}
	this.memoryWriter[0xFF37] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF37] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF37] = data;
			parentObj.channel3PCM[0x0E] = (data >> 4) / 0x1E;
			parentObj.channel3PCM[0x2E] = (data >> 5) / 0x1E;
			parentObj.channel3PCM[0x4E] = (data >> 6) / 0x1E;
			parentObj.channel3PCM[0x0F] = (data & 0xF) / 0x1E;
			parentObj.channel3PCM[0x2F] = (data & 0xE) / 0x3C;
			parentObj.channel3PCM[0x4F] = (data & 0xC) / 0x78;
		}
	}
	this.memoryWriter[0xFF38] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF38] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF38] = data;
			parentObj.channel3PCM[0x10] = (data >> 4) / 0x1E;
			parentObj.channel3PCM[0x30] = (data >> 5) / 0x1E;
			parentObj.channel3PCM[0x50] = (data >> 6) / 0x1E;
			parentObj.channel3PCM[0x11] = (data & 0xF) / 0x1E;
			parentObj.channel3PCM[0x31] = (data & 0xE) / 0x3C;
			parentObj.channel3PCM[0x51] = (data & 0xC) / 0x78;
		}
	}
	this.memoryWriter[0xFF39] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF39] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF39] = data;
			parentObj.channel3PCM[0x12] = (data >> 4) / 0x1E;
			parentObj.channel3PCM[0x32] = (data >> 5) / 0x1E;
			parentObj.channel3PCM[0x52] = (data >> 6) / 0x1E;
			parentObj.channel3PCM[0x13] = (data & 0xF) / 0x1E;
			parentObj.channel3PCM[0x33] = (data & 0xE) / 0x3C;
			parentObj.channel3PCM[0x53] = (data & 0xC) / 0x78;
		}
	}
	this.memoryWriter[0xFF3A] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF3A] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF3A] = data;
			parentObj.channel3PCM[0x14] = (data >> 4) / 0x1E;
			parentObj.channel3PCM[0x34] = (data >> 5) / 0x1E;
			parentObj.channel3PCM[0x54] = (data >> 6) / 0x1E;
			parentObj.channel3PCM[0x15] = (data & 0xF) / 0x1E;
			parentObj.channel3PCM[0x35] = (data & 0xE) / 0x3C;
			parentObj.channel3PCM[0x55] = (data & 0xC) / 0x78;
		}
	}
	this.memoryWriter[0xFF3B] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF3B] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF3B] = data;
			parentObj.channel3PCM[0x16] = (data >> 4) / 0x1E;
			parentObj.channel3PCM[0x36] = (data >> 5) / 0x1E;
			parentObj.channel3PCM[0x56] = (data >> 6) / 0x1E;
			parentObj.channel3PCM[0x17] = (data & 0xF) / 0x1E;
			parentObj.channel3PCM[0x37] = (data & 0xE) / 0x3C;
			parentObj.channel3PCM[0x57] = (data & 0xC) / 0x78;
		}
	}
	this.memoryWriter[0xFF3C] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF3C] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF3C] = data;
			parentObj.channel3PCM[0x18] = (data >> 4) / 0x1E;
			parentObj.channel3PCM[0x38] = (data >> 5) / 0x1E;
			parentObj.channel3PCM[0x58] = (data >> 6) / 0x1E;
			parentObj.channel3PCM[0x19] = (data & 0xF) / 0x1E;
			parentObj.channel3PCM[0x39] = (data & 0xE) / 0x3C;
			parentObj.channel3PCM[0x59] = (data & 0xC) / 0x78;
		}
	}
	this.memoryWriter[0xFF3D] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF3D] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF3D] = data;
			parentObj.channel3PCM[0x1A] = (data >> 4) / 0x1E;
			parentObj.channel3PCM[0x3A] = (data >> 5) / 0x1E;
			parentObj.channel3PCM[0x5A] = (data >> 6) / 0x1E;
			parentObj.channel3PCM[0x1B] = (data & 0xF) / 0x1E;
			parentObj.channel3PCM[0x3B] = (data & 0xE) / 0x3C;
			parentObj.channel3PCM[0x5B] = (data & 0xC) / 0x78;
		}
	}
	this.memoryWriter[0xFF3E] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF3E] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF3E] = data;
			parentObj.channel3PCM[0x1C] = (data >> 4) / 0x1E;
			parentObj.channel3PCM[0x3C] = (data >> 5) / 0x1E;
			parentObj.channel3PCM[0x5C] = (data >> 6) / 0x1E;
			parentObj.channel3PCM[0x1D] = (data & 0xF) / 0x1E;
			parentObj.channel3PCM[0x3D] = (data & 0xE) / 0x3C;
			parentObj.channel3PCM[0x5D] = (data & 0xC) / 0x78;
		}
	}
	this.memoryWriter[0xFF3F] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF3F] != data) {
			parentObj.audioJIT();
			parentObj.memory[0xFF3F] = data;
			parentObj.channel3PCM[0x1E] = (data >> 4) / 0x1E;
			parentObj.channel3PCM[0x3E] = (data >> 5) / 0x1E;
			parentObj.channel3PCM[0x5E] = (data >> 6) / 0x1E;
			parentObj.channel3PCM[0x1F] = (data & 0xF) / 0x1E;
			parentObj.channel3PCM[0x3F] = (data & 0xE) / 0x3C;
			parentObj.channel3PCM[0x5F] = (data & 0xC) / 0x78;
		}
	}
	//SCY
	this.memoryWriter[0xFF42] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF42] != data) {
			parentObj.renderMidScanLine();
			parentObj.memory[0xFF42] = data;
		}
	}
	//SCX
	this.memoryWriter[0xFF43] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF43] != data) {
			parentObj.renderMidScanLine();
			parentObj.memory[0xFF43] = data;
		}
	}
	//LY
	this.memoryWriter[0xFF44] = function (parentObj, address, data) {
		//Read Only:
		if (parentObj.LCDisOn) {
			//Gambatte says to do this:
			if (parentObj.drewBlank == 0 && (parentObj.actualScanLine > 0 || parentObj.STATTracker == 2)) {
				//Blit out the partial frame:
				parentObj.drawToCanvas();
			}
			parentObj.modeSTAT = parentObj.LCDTicks = parentObj.STATTracker = parentObj.actualScanLine = parentObj.memory[0xFF44] = 0;
		}
	}
	//LYC
	this.memoryWriter[0xFF45] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF45] != data) {
			parentObj.memory[0xFF45] = data;
			if (parentObj.LCDisOn) {
				parentObj.matchLYC();	//Get the compare of the first scan line.
			}
		}
	}
	//WY
	this.memoryWriter[0xFF4A] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF4A] != data) {
			parentObj.renderMidScanLine();
			parentObj.memory[0xFF4A] = data;
			parentObj.windowY = (data > 159) ? 159 : data;
		}
	}
	//WX
	this.memoryWriter[0xFF4B] = function (parentObj, address, data) {
		if (parentObj.memory[0xFF4B] != data) {
			parentObj.renderMidScanLine();
			parentObj.memory[0xFF4B] = data;
			data -= 7;
			if (data < 0) {
				data = 0;
			}
			else if (data > 159) {
				data = 160;
			}
			parentObj.windowX = data;
		}
	}
	this.memoryWriter[0xFF72] = function (parentObj, address, data) {
		parentObj.memory[0xFF72] = data;
	}
	this.memoryWriter[0xFF73] = function (parentObj, address, data) {
		parentObj.memory[0xFF73] = data;
	}
	this.memoryWriter[0xFF75] = function (parentObj, address, data) {
		parentObj.memory[0xFF75] = data;
	}
	this.memoryWriter[0xFF76] = this.cartIgnoreWrite;
	this.memoryWriter[0xFF77] = this.cartIgnoreWrite;
	//IE (Interrupt Enable)
	this.memoryWriter[0xFFFF] = function (parentObj, address, data) {
		parentObj.interruptsEnabled = data;
	}
	if (this.cGBC) {
		//GameBoy Color Specific I/O:
		this.memoryWriter[0xFF40] = function (parentObj, address, data) {
			if (parentObj.memory[0xFF40] != data) {
				parentObj.renderMidScanLine();
			}
			var temp_var = (data & 0x80) == 0x80;
			if (temp_var != parentObj.LCDisOn) {
				//When the display mode changes...
				parentObj.LCDisOn = temp_var;
				parentObj.memory[0xFF41] &= 0xF8;
				parentObj.modeSTAT = parentObj.STATTracker = parentObj.LCDTicks = parentObj.actualScanLine = parentObj.memory[0xFF44] = 0;
				if (parentObj.LCDisOn) {
					parentObj.matchLYC();	//Get the compare of the first scan line.
					parentObj.LCDCONTROL = parentObj.LINECONTROL;
				}
				else {
					parentObj.LCDCONTROL = parentObj.DISPLAYOFFCONTROL;
					parentObj.DisplayShowOff();
				}
				parentObj.interruptsRequested &= 0xFD;
			}
			parentObj.gfxWindowCHRBankPosition = ((data & 0x40) == 0x40) ? 0x400 : 0;
			parentObj.gfxWindowDisplay = (data & 0x20) == 0x20;
			parentObj.gfxBackgroundBankOffset = ((data & 0x10) == 0x10) ? 0 : 0x80;
			parentObj.gfxBackgroundCHRBankPosition = ((data & 0x08) == 0x08) ? 0x400 : 0;
			parentObj.gfxSpriteDouble = ((data & 0x04) == 0x04);
			parentObj.gfxSpriteShow = (data & 0x02) == 0x02;
			parentObj.BGPriorityEnabled = ((data & 0x01) == 0x01) ? 0x1000000 : 0;
			parentObj.memory[0xFF40] = data;
		}
		this.memoryWriter[0xFF41] = function (parentObj, address, data) {
			parentObj.LYCMatchTriggerSTAT = ((data & 0x40) == 0x40);
			parentObj.mode2TriggerSTAT = ((data & 0x20) == 0x20);
			parentObj.mode1TriggerSTAT = ((data & 0x10) == 0x10);
			parentObj.mode0TriggerSTAT = ((data & 0x08) == 0x08);
			parentObj.memory[0xFF41] = (data & 0xF8);
		}
		this.memoryWriter[0xFF46] = function (parentObj, address, data) {
			parentObj.memory[0xFF46] = data;
			if (data < 0xE0) {
				data <<= 8;
				address = 0xFE00;
				var stat = parentObj.modeSTAT;
				parentObj.modeSTAT = 0;
				while (address < 0xFEA0) {
					parentObj.memory[address++] = parentObj.memoryReader[data](parentObj, data++);
				}
				parentObj.modeSTAT = stat;
			}
		}
		//KEY1
		this.memoryWriter[0xFF4D] = function (parentObj, address, data) {
			parentObj.memory[0xFF4D] = (data & 0x7F) | (parentObj.memory[0xFF4D] & 0x80);
		}
		this.memoryWriter[0xFF4F] = function (parentObj, address, data) {
			parentObj.currVRAMBank = data & 0x01;
			if (parentObj.currVRAMBank > 0) {
				parentObj.BGCHRCurrentBank = parentObj.BGCHRBank2;
			}
			else {
				parentObj.BGCHRCurrentBank = parentObj.BGCHRBank1;
			}
			//Only writable by GBC.
		}
		this.memoryWriter[0xFF51] = function (parentObj, address, data) {
			if (!parentObj.hdmaRunning) {
				parentObj.memory[0xFF51] = data;
			}
		}
		this.memoryWriter[0xFF52] = function (parentObj, address, data) {
			if (!parentObj.hdmaRunning) {
				parentObj.memory[0xFF52] = data & 0xF0;
			}
		}
		this.memoryWriter[0xFF53] = function (parentObj, address, data) {
			if (!parentObj.hdmaRunning) {
				parentObj.memory[0xFF53] = data & 0x1F;
			}
		}
		this.memoryWriter[0xFF54] = function (parentObj, address, data) {
			if (!parentObj.hdmaRunning) {
				parentObj.memory[0xFF54] = data & 0xF0;
			}
		}
		this.memoryWriter[0xFF55] = function (parentObj, address, data) {
			if (!parentObj.hdmaRunning) {
				if ((data & 0x80) == 0) {
					//DMA
					parentObj.DMAWrite((data & 0x7F) + 1);
					parentObj.memory[0xFF55] = 0xFF;	//Transfer completed.
				}
				else {
					//H-Blank DMA
					parentObj.hdmaRunning = true;
					parentObj.memory[0xFF55] = data & 0x7F;
				}
			}
			else if ((data & 0x80) == 0) {
				//Stop H-Blank DMA
				parentObj.hdmaRunning = false;
				parentObj.memory[0xFF55] |= 0x80;
			}
			else {
				parentObj.memory[0xFF55] = data & 0x7F;
			}
		}
		this.memoryWriter[0xFF68] = function (parentObj, address, data) {
			parentObj.memory[0xFF69] = parentObj.gbcBGRawPalette[data & 0x3F];
			parentObj.memory[0xFF68] = data;
		}
		this.memoryWriter[0xFF69] = function (parentObj, address, data) {
			parentObj.updateGBCBGPalette(parentObj.memory[0xFF68] & 0x3F, data);
			if (parentObj.memory[0xFF68] > 0x7F) { // high bit = autoincrement
				var next = ((parentObj.memory[0xFF68] + 1) & 0x3F);
				parentObj.memory[0xFF68] = (next | 0x80);
				parentObj.memory[0xFF69] = parentObj.gbcBGRawPalette[next];
			}
			else {
				parentObj.memory[0xFF69] = data;
			}
		}
		this.memoryWriter[0xFF6A] = function (parentObj, address, data) {
			parentObj.memory[0xFF6B] = parentObj.gbcOBJRawPalette[data & 0x3F];
			parentObj.memory[0xFF6A] = data;
		}
		this.memoryWriter[0xFF6B] = function (parentObj, address, data) {
			parentObj.updateGBCOBJPalette(parentObj.memory[0xFF6A] & 0x3F, data);
			if (parentObj.memory[0xFF6A] > 0x7F) { // high bit = autoincrement
				var next = ((parentObj.memory[0xFF6A] + 1) & 0x3F);
				parentObj.memory[0xFF6A] = (next | 0x80);
				parentObj.memory[0xFF6B] = parentObj.gbcOBJRawPalette[next];
			}
			else {
				parentObj.memory[0xFF6B] = data;
			}
		}
		//SVBK
		this.memoryWriter[0xFF70] = function (parentObj, address, data) {
			var addressCheck = (parentObj.memory[0xFF51] << 8) | parentObj.memory[0xFF52];	//Cannot change the RAM bank while WRAM is the source of a running HDMA.
			if (!parentObj.hdmaRunning || addressCheck < 0xD000 || addressCheck >= 0xE000) {
				parentObj.gbcRamBank = Math.max(data & 0x07, 1);	//Bank range is from 1-7
				parentObj.gbcRamBankPosition = ((parentObj.gbcRamBank - 1) << 12) - 0xD000;
				parentObj.gbcRamBankPositionECHO = parentObj.gbcRamBankPosition - 0x2000;
			}
			parentObj.memory[0xFF70] = data;	//Bit 6 cannot be written to.
		}
		this.memoryWriter[0xFF74] = function (parentObj, address, data) {
			parentObj.memory[0xFF74] = data;
		}
	}
	else {
		//Fill in the GameBoy Color I/O registers as normal RAM for GameBoy compatibility:
		this.memoryWriter[0xFF40] = function (parentObj, address, data) {
			if (parentObj.memory[0xFF40] != data) {
				parentObj.renderMidScanLine();
			}
			var temp_var = (data & 0x80) == 0x80;
			if (temp_var != parentObj.LCDisOn) {
				//When the display mode changes...
				parentObj.LCDisOn = temp_var;
				parentObj.memory[0xFF41] &= 0xF8;
				parentObj.modeSTAT = parentObj.STATTracker = parentObj.LCDTicks = parentObj.actualScanLine = parentObj.memory[0xFF44] = 0;
				if (parentObj.LCDisOn) {
					parentObj.matchLYC();	//Get the compare of the first scan line.
					parentObj.LCDCONTROL = parentObj.LINECONTROL;
				}
				else {
					parentObj.LCDCONTROL = parentObj.DISPLAYOFFCONTROL;
					parentObj.DisplayShowOff();
				}
				parentObj.interruptsRequested &= 0xFD;
			}
			parentObj.gfxWindowCHRBankPosition = ((data & 0x40) == 0x40) ? 0x400 : 0;
			parentObj.gfxWindowDisplay = (data & 0x20) == 0x20;
			parentObj.gfxBackgroundBankOffset = ((data & 0x10) == 0x10) ? 0 : 0x80;
			parentObj.gfxBackgroundCHRBankPosition = ((data & 0x08) == 0x08) ? 0x400 : 0;
			parentObj.gfxSpriteDouble = ((data & 0x04) == 0x04);
			parentObj.gfxSpriteShow = (data & 0x02) == 0x02;
			if ((data & 0x01) == 0) {
				// this emulates the gbc-in-gb-mode, not the original gb-mode
				parentObj.bgEnabled = false;
				parentObj.gfxWindowDisplay = false;
			}
			else {
				parentObj.bgEnabled = true;
			}
			parentObj.memory[0xFF40] = data;
		}
		this.memoryWriter[0xFF41] = function (parentObj, address, data) {
			parentObj.LYCMatchTriggerSTAT = ((data & 0x40) == 0x40);
			parentObj.mode2TriggerSTAT = ((data & 0x20) == 0x20);
			parentObj.mode1TriggerSTAT = ((data & 0x10) == 0x10);
			parentObj.mode0TriggerSTAT = ((data & 0x08) == 0x08);
			parentObj.memory[0xFF41] = (data & 0xF8);
			if (!parentObj.usedBootROM && parentObj.LCDisOn && parentObj.modeSTAT < 2) {
				parentObj.interruptsRequested |= 0x2;
			}
		}
		this.memoryWriter[0xFF46] = function (parentObj, address, data) {
			parentObj.memory[0xFF46] = data;
			if (data > 0x7F && data < 0xE0) {	//DMG cannot DMA from the ROM banks.
				data <<= 8;
				address = 0xFE00;
				var stat = parentObj.modeSTAT;
				parentObj.modeSTAT = 0;
				while (address < 0xFEA0) {
					parentObj.memoryWriter[address](parentObj, address++, parentObj.memoryReader[data](parentObj, data++));
				}
				parentObj.modeSTAT = stat;
			}
		}
		this.memoryWriter[0xFF47] = function (parentObj, address, data) {
			if (parentObj.memory[0xFF47] != data) {
				parentObj.renderMidScanLine();
				parentObj.updateGBBGPalette(data);
				parentObj.memory[0xFF47] = data;
			}
		}
		this.memoryWriter[0xFF48] = function (parentObj, address, data) {
			if (parentObj.memory[0xFF48] != data) {
				parentObj.renderMidScanLine();
				parentObj.updateGBOBJPalette(0, data);
				parentObj.memory[0xFF48] = data;
			}
		}
		this.memoryWriter[0xFF49] = function (parentObj, address, data) {
			if (parentObj.memory[0xFF49] != data) {
				parentObj.renderMidScanLine();
				parentObj.updateGBOBJPalette(4, data);
				parentObj.memory[0xFF49] = data;
			}
		}
		this.memoryWriter[0xFF4D] = function (parentObj, address, data) {
			parentObj.memory[0xFF4D] = data;
		}
		this.memoryWriter[0xFF4F] = this.cartIgnoreWrite;	//Not writable in DMG mode.
		this.memoryWriter[0xFF55] = this.cartIgnoreWrite;
		this.memoryWriter[0xFF68] = this.cartIgnoreWrite;
		this.memoryWriter[0xFF69] = this.cartIgnoreWrite;
		this.memoryWriter[0xFF6A] = this.cartIgnoreWrite;
		this.memoryWriter[0xFF6B] = this.cartIgnoreWrite;
		this.memoryWriter[0xFF6C] = this.cartIgnoreWrite;
		this.memoryWriter[0xFF70] = this.cartIgnoreWrite;
		this.memoryWriter[0xFF74] = this.cartIgnoreWrite;
	}
	//Boot I/O Registers:
	if (this.inBootstrap) {
		this.memoryWriter[0xFF50] = function (parentObj, address, data) {
			cout("Boot ROM reads blocked: Bootstrap process has ended.", 0);
			parentObj.inBootstrap = false;
			parentObj.disableBootROM();			//Fill in the boot ROM ranges with ROM  bank 0 ROM ranges
			parentObj.memory[0xFF50] = data;	//Bits are sustained in memory?
		}
		if (this.cGBC) {
			this.memoryWriter[0xFF6C] = function (parentObj, address, data) {
				if (parentObj.inBootstrap) {
					parentObj.cGBC = ((data & 0x1) == 0);
					cout("Booted to GBC Mode: " + parentObj.cGBC, 0);
				}
				parentObj.memory[0xFF6C] = data;
			}
		}
	}
	else {
		//Lockout the ROMs from accessing the BOOT ROM control register:
		this.memoryWriter[0xFF50] = this.cartIgnoreWrite;
	}
}
//Helper Functions
GameBoyCore.prototype.usbtsb = function (ubyte) {
	//Unsigned byte to signed byte:
	return (ubyte & 0x7F) - (ubyte & 0x80);
}
GameBoyCore.prototype.toTypedArray = function (baseArray, memtype) {
	try {
		if (!baseArray || !baseArray.length) {
			return [];
		}
		var length = baseArray.length;
		switch (memtype) {
			case "uint8":
				var typedArrayTemp = new Uint8Array(length);
				break;
			case "uint16":
				var typedArrayTemp = new Uint16Array(length);
				break;
			case "int32":
				var typedArrayTemp = new Int32Array(length);
				break;
			case "float32":
				var typedArrayTemp = new Float32Array(length);
				break;
			default:
				cout("Could not convert an array to a typed array: Invalid type parameter.", 1);
				return baseArray;
		}
		for (var index = 0; index < length; index++) {
			typedArrayTemp[index] = baseArray[index];
		}
		return typedArrayTemp;
	}
	catch (error) {
		cout("Could not convert an array to a typed array: " + error.message, 1);
		return baseArray;
	}
}
GameBoyCore.prototype.fromTypedArray = function (baseArray) {
	try {
		if (!baseArray || !baseArray.length) {
			return [];
		}
		var arrayTemp = new Array(baseArray.length);
		for (var index = 0; index < baseArray.length; index++) {
			arrayTemp[index] = baseArray[index];
		}
		return arrayTemp;
	}
	catch (error) {
		cout("Conversion from a typed array failed: " + error.message, 2);
		return baseArray;
	}
}
GameBoyCore.prototype.getTypedArray = function (length, defaultValue, numberType) {
	try {
		if (settings[22]) {
			throw(new Error(""));
		}
		switch (numberType) {
			case "uint8":
				var arrayHandle = new Uint8Array(length);
				break;
			case "int8":
				var arrayHandle = new Int8Array(length);
				break;
			case "uint16":
				var arrayHandle = new Uint16Array(length);
				break;
			case "int16":
				var arrayHandle = new Int16Array(length);
				break;
			case "uint32":
				var arrayHandle = new Uint32Array(length);
				break;
			case "int32":
				var arrayHandle = new Int32Array(length);
				break;
			case "float32":
				var arrayHandle = new Float32Array(length);
		}
		if (defaultValue > 0) {
			var index = 0;
			while (index < length) {
				arrayHandle[index++] = defaultValue;
			}
		}
	}
	catch (error) {
		var arrayHandle = new Array(length);
		var index = 0;
		while (index < length) {
			arrayHandle[index++] = defaultValue;
		}
	}
	return arrayHandle;
}
GameBoyCore.prototype.audioBufferSlice = function (length) {
	if (typeof this.currentBuffer.subarray == "function") {
		//"I am disappoint" I had to change this one day later from subset:
		return this.currentBuffer.subarray(0, length);
	}
	else {
		return this.currentBuffer.slice(0, length);
	}
}
GameBoyCore.prototype.ArrayPad = function (length, defaultValue) {
	var arrayHandle = new Array(length);
	var index = 0;
	while (index < length) {
		arrayHandle[index++] = defaultValue;
	}
	return arrayHandle;
}
GameBoyCore.prototype.returnOAMXCacheCopy = function (array) {
	var arrayHandle = this.ArrayPad(0x100, null);
	for (var subindex = 0; subindex < 0x100; subindex++) {
		arrayHandle[subindex] = [];
	}
	if (array.length) {
		var index = 0;
		var length = 0;
		while (index < length) {
			length = array[index].length;
			for (subindex = 0; subindex < length; subindex++) {
				arrayHandle[index][subindex] = array[index][subindex];
			}
			index++;
		}
		cout("OAM sprite cached preserved.", 0);
	}
	return arrayHandle;
}
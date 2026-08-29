import os
import sys
import subprocess
import shutil
from pathlib import Path

# Supported video file extensions
VIDEO_EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v'}

def check_ffmpeg():
    """Check if ffmpeg is available in the system PATH."""
    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path:
        return ffmpeg_path
    
    # Common fallback paths on Windows if not in system PATH
    common_paths = [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        r"C:\tools\ffmpeg\bin\ffmpeg.exe"
    ]
    for p in common_paths:
        if os.path.exists(p):
            return p
    return None

from burn_captions import burn_captions

def process_video(ffmpeg_bin, input_path: Path, output_path: Path):
    """
    Crops top 20% overlay banner section, rescales and center-crops remaining video
    to 1080x1920 (9:16 ratio) without stretching, and hardburns 2-4 word Whisper captions.
    """
    print(f"\nProcessing: {input_path.name}")
    print(f" -> Input:  {input_path}")
    print(f" -> Output: {output_path}")

    temp_cleaned = output_path.parent / f"temp_{output_path.name}"

    # FFmpeg filter pipeline:
    # 1. crop=iw:ih*0.80:0:ih*0.20 -> Crop off top 20% banner section
    # 2. scale=1080:1920:force_original_aspect_ratio=increase -> Rescale proportionally to cover 1080x1920
    # 3. crop=1080:1920 -> Center crop to exact 1080x1920 canvas without stretching
    # 4. fps=30,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p -> Timebase & frame rate normalization
    vf_chain = "crop=iw:ih*0.80:0:ih*0.20,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p"

    cmd = [
        ffmpeg_bin,
        "-y",                   # Overwrite output file if exists
        "-i", str(input_path),  # Input video file
        "-vf", vf_chain,        # Video filter pipeline
        "-c:v", "libx264",      # H.264 video codec
        "-preset", "fast",      # Fast encoding preset
        "-crf", "18",           # High visual quality
        "-c:a", "aac",          # Standard AAC audio encoding
        "-b:a", "192k",         # Audio bitrate
        str(temp_cleaned)
    ]

    try:
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        print(f"✅ Video pre-processed to 1080x1920: {temp_cleaned.name}")
        
        # Burn in dynamic 2-4 word Whisper captions at Y=1450px (~75% down screen)
        caption_success = burn_captions(str(temp_cleaned), str(output_path), model_size="base", target_y=1450)
        
        if temp_cleaned.exists():
            temp_cleaned.unlink()

        if caption_success:
            print(f"🎉 Successfully processed and captioned {input_path.name} -> {output_path}")
            return True
        else:
            print(f"❌ Caption burn-in failed for {input_path.name}")
            return False

    except subprocess.CalledProcessError as e:
        print(f"Error processing {input_path.name}:")
        print(e.stderr[-1000:])  # Print last 1000 chars of ffmpeg error log
        if temp_cleaned.exists():
            temp_cleaned.unlink()
        return False

def main():
    base_dir = Path(__file__).parent.resolve()
    input_dir = base_dir / "input"
    output_dir = base_dir / "output"

    # Ensure input and output directories exist
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    ffmpeg_bin = check_ffmpeg()
    if not ffmpeg_bin:
        print("ERROR: FFmpeg executable not found. Please ensure FFmpeg is installed and added to PATH.")
        sys.exit(1)

    print(f"FFmpeg binary found: {ffmpeg_bin}")
    print(f"Input directory:  {input_dir}")
    print(f"Output directory: {output_dir}")

    # Find all videos in input directory
    video_files = [f for f in input_dir.iterdir() if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS]

    if not video_files:
        print(f"\nNo video files found in '{input_dir}'.")
        print("Please place your YouTube Shorts video files in the 'input/' folder and re-run this script.")
        return

    print(f"\nFound {len(video_files)} video(s) to process:")
    for v in video_files:
        print(f" - {v.name}")

    success_count = 0
    fail_count = 0

    for video_file in video_files:
        output_file = output_dir / f"cleaned_{video_file.stem}{video_file.suffix}"
        if process_video(ffmpeg_bin, video_file, output_file):
            success_count += 1
        else:
            fail_count += 1

    print("\n" + "="*50)
    print(f"Processing Complete! Successfully processed: {success_count}/{len(video_files)} video(s).")
    if fail_count > 0:
        print(f"Failed: {fail_count} video(s). Check logs above.")

if __name__ == "__main__":
    main()


import os
import sys
import argparse
import subprocess
import shutil
import tempfile
import re
import json
from pathlib import Path
from faster_whisper import WhisperModel

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

VIDEO_EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v'}

def check_ffmpeg():
    """Locate FFmpeg executable in PATH or common Windows locations."""
    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path:
        return ffmpeg_path

    common_paths = [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        r"C:\tools\ffmpeg\bin\ffmpeg.exe"
    ]
    for p in common_paths:
        if os.path.exists(p):
            return p
    local_tools = Path(__file__).parent.resolve() / "tools" / "ffmpeg"
    if local_tools.exists():
        for candidate in local_tools.rglob("ffmpeg.exe" if os.name == "nt" else "ffmpeg"):
            if candidate.is_file():
                return str(candidate)
    return None

def format_timestamp_ass(seconds: float) -> str:
    """Format seconds into ASS timestamp string H:MM:SS.cs (centiseconds)."""
    if seconds < 0:
        seconds = 0
    total_cs = int(round(seconds * 100))
    cs = total_cs % 100
    total_s = total_cs // 100
    s = total_s % 60
    total_m = total_s // 60
    m = total_m % 60
    h = total_m // 60
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

def chunk_transcript(words_list, max_words=4, min_words=2, max_pause=0.45, max_duration=2.2):
    """
    Chunk word-level timestamps into short 2-4 word phrases for dynamic/TikTok-style captions.
    Guarantees 1 single line per display frame.
    """
    if not words_list:
        return []

    chunks = []
    current_chunk = []

    for i, word_item in enumerate(words_list):
        start, end, word = word_item
        word_clean = word.strip()
        if not word_clean:
            continue

        if not current_chunk:
            current_chunk.append({'start': start, 'end': end, 'word': word_clean})
        else:
            prev_word = current_chunk[-1]
            pause = start - prev_word['end']
            chunk_duration = end - current_chunk[0]['start']
            prev_text = prev_word['word']
            ends_sentence = any(prev_text.endswith(p) for p in ['.', '?', '!', ',', ';', ':'])

            # Split conditions: max words reached, long pause, sentence end, or max duration exceeded
            if (len(current_chunk) >= max_words or 
                pause > max_pause or 
                ends_sentence or 
                (chunk_duration > max_duration and len(current_chunk) >= min_words)):
                
                # Close current chunk
                c_start = current_chunk[0]['start']
                c_end = current_chunk[-1]['end']
                c_text = " ".join(w['word'] for w in current_chunk).strip()
                # Ensure single line (no newlines) and UPPERCASE formatting for high punchy readability
                c_text = re.sub(r'\s+', ' ', c_text).upper()
                chunks.append({'start': c_start, 'end': c_end, 'text': c_text})
                current_chunk = [{'start': start, 'end': end, 'word': word_clean}]
            else:
                current_chunk.append({'start': start, 'end': end, 'word': word_clean})

    if current_chunk:
        c_start = current_chunk[0]['start']
        c_end = current_chunk[-1]['end']
        c_text = " ".join(w['word'] for w in current_chunk).strip()
        c_text = re.sub(r'\s+', ' ', c_text).upper()
        chunks.append({'start': c_start, 'end': c_end, 'text': c_text})

    # Small gap adjustments to prevent overlapping/flicker
    for i in range(len(chunks) - 1):
        if chunks[i]['end'] > chunks[i+1]['start']:
            chunks[i]['end'] = chunks[i+1]['start']
        elif chunks[i+1]['start'] - chunks[i]['end'] < 0.05:
            chunks[i]['end'] = chunks[i+1]['start']

    return chunks

def generate_ass(chunks, ass_path, canvas_w=1080, canvas_h=1920, font_name="Arial", font_size=50, primary_color="white", target_y=1450):
    """
    Generate Advanced SubStation Alpha (.ass) subtitle file.
    Placement: lower-middle area (~75% down screen, Y=1450 on 1080x1920 vertical canvas).
    Styling: Bold clean sans-serif, White/Yellow text, 4px solid Black stroke outline.
    """
    # ASS color syntax: &HAABBGGRR (hex)
    if primary_color.lower() in ["yellow", "#ffff00", "#fff000"]:
        primary_bgr = "&H0000FFFF"  # Yellow (R:255, G:255, B:0)
    else:
        primary_bgr = "&H00FFFFFF"  # White (R:255, G:255, B:255)

    outline_bgr = "&H00000000"     # Solid Black

    # MarginV from bottom when Alignment=2 (Bottom-Center)
    margin_v = max(10, canvas_h - target_y)
    center_x = canvas_w // 2

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {canvas_w}
PlayResY: {canvas_h}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: DynamicCaption,{font_name},{font_size},{primary_bgr},&H000000FF,{outline_bgr},&H00000000,-1,0,0,0,100,100,0,0,1,4.0,0.0,2,20,20,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    lines = [header]
    for chunk in chunks:
        start_str = format_timestamp_ass(chunk['start'])
        end_str = format_timestamp_ass(chunk['end'])
        # Escape special ASS characters
        clean_text = chunk['text'].replace('{', '\\{').replace('}', '\\}')
        # Explicit positioning tag {\pos(X, Y)} guarantees exact target_y placement
        event = f"Dialogue: 0,{start_str},{end_str},DynamicCaption,,0,0,0,,{{\\pos({center_x},{target_y})}}{clean_text}\n"
        lines.append(event)

    with open(ass_path, "w", encoding="utf-8") as f:
        f.writelines(lines)

def burn_captions(input_video: str, output_video: str, model_size: str = "base", font_name: str = "Arial", primary_color: str = "white", target_y: int = 1450, canvas_w: int = 1080, canvas_h: int = 1920, transcript_output: str = None) -> bool:
    """
    Extracts speech timestamps using faster-whisper, formats ASS subtitles,
    and hardburns 2-4 word captions into output_video using FFmpeg.
    """
    input_path = Path(input_video).resolve()
    output_path = Path(output_video).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        print(f"❌ Input video not found: {input_path}")
        return False

    ffmpeg_bin = check_ffmpeg()
    if not ffmpeg_bin:
        print("❌ FFmpeg executable not found.")
        return False

    print(f"\n🎙️ Extracting speech timestamps from '{input_path.name}' using Whisper ({model_size} model)...")
    try:
        model = WhisperModel(model_size, device="cpu", compute_type="float32")
        segments, info = model.transcribe(str(input_path), word_timestamps=True, language="en")

        words = []
        for segment in segments:
            for w in segment.words:
                words.append((w.start, w.end, w.word))
        if transcript_output:
            transcript_path = Path(transcript_output).resolve()
            transcript_path.parent.mkdir(parents=True, exist_ok=True)
            transcript_payload = {
                "text": " ".join(word[2].strip() for word in words if word[2].strip()),
                "language": getattr(info, "language", None),
                "languageProbability": getattr(info, "language_probability", None),
                "words": [
                    {"start": start, "end": end, "word": word.strip()}
                    for start, end, word in words if word.strip()
                ]
            }
            with open(transcript_path, "w", encoding="utf-8") as transcript_file:
                json.dump(transcript_payload, transcript_file, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"❌ Whisper transcription failed: {e}")
        return False

    if not words:
        print("⚠️ No spoken words detected in video. Copying original video to output...")
        shutil.copyfile(input_path, output_path)
        return True

    print(f"✅ Extracted {len(words)} word timestamps. Chunking into 2-4 word display frames...")
    chunks = chunk_transcript(words, max_words=4, min_words=2, max_pause=0.45, max_duration=2.2)
    print(f"✅ Generated {len(chunks)} short caption frames.")

    with tempfile.TemporaryDirectory() as tmp_dir:
        ass_path = Path(tmp_dir) / "captions.ass"
        generate_ass(chunks, ass_path, canvas_w=canvas_w, canvas_h=canvas_h, font_name=font_name, font_size=50, primary_color=primary_color, target_y=target_y)

        print(f"🔥 Hardburning captions into '{output_path.name}' via FFmpeg...")
        # Format ASS file path for FFmpeg vf filter (escape Windows colon and backslashes)
        ass_str = str(ass_path).replace("\\", "/").replace(":", "\\:")
        fonts_dir = (Path(__file__).resolve().parent / "assets")
        if fonts_dir.exists():
            fonts_str = str(fonts_dir).replace("\\", "/").replace(":", "\\:")
            vf_filter = f"subtitles='{ass_str}':fontsdir='{fonts_str}'"
        else:
            vf_filter = f"subtitles='{ass_str}'"

        cmd = [
            ffmpeg_bin,
            "-y",
            "-i", str(input_path),
            "-vf", vf_filter,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "18",
            "-c:a", "aac",
            "-b:a", "192k",
            str(output_path)
        ]

        try:
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
            print(f"🎉 Successfully rendered captioned video -> '{output_path}'")
            return True
        except subprocess.CalledProcessError as e:
            print(f"❌ FFmpeg caption burn-in failed:\n{e.stderr[-1000:]}")
            return False

def main():
    parser = argparse.ArgumentParser(description="Burn dynamic 2-4 word Whisper captions into video.")
    parser.add_argument("--input", "-i", required=True, help="Input video file path")
    parser.add_argument("--output", "-o", required=True, help="Output video file path")
    parser.add_argument("--model", "-m", default="base", help="Whisper model size (base, small, etc.)")
    parser.add_argument("--font", default="Arial", help="Subtitle font family (e.g. Arial, Impact, Montserrat)")
    parser.add_argument("--color", default="white", help="Primary text color (white, yellow)")
    parser.add_argument("--target-y", type=int, default=1450, help="Y position on canvas")
    parser.add_argument("--canvas-w", type=int, default=1080, help="Canvas width (default: 1080)")
    parser.add_argument("--canvas-h", type=int, default=1920, help="Canvas height (default: 1920)")
    parser.add_argument("--transcript-output", help="Write Faster-Whisper transcript metadata as JSON")

    args = parser.parse_args()
    success = burn_captions(args.input, args.output, model_size=args.model, font_name=args.font, primary_color=args.color, target_y=args.target_y, canvas_w=args.canvas_w, canvas_h=args.canvas_h, transcript_output=args.transcript_output)
    if not success:
        sys.exit(1)

if __name__ == "__main__":
    main()

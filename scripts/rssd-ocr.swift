// Reads the text drawn in pictures with macOS's own text recognition (Vision), for checking model-drawn lettering.
// Usage: rssd-ocr <image>...  → JSON: [{file, lines:[{text, confidence, x, y, w, h}]}], boxes as fractions from the top left.
import Foundation
import Vision
import AppKit

var results: [[String: Any]] = []
for path in CommandLine.arguments.dropFirst() {
  guard let image = NSImage(contentsOfFile: path),
        let picture = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    results.append(["file": path, "error": "cannot read the picture"]); continue
  }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false
  request.recognitionLanguages = ["zh-Hans", "en-US"]
  do { try VNImageRequestHandler(cgImage: picture, options: [:]).perform([request]) }
  catch { results.append(["file": path, "error": "\(error)"]); continue }
  var lines: [[String: Any]] = []
  for observation in request.results ?? [] {
    guard let best = observation.topCandidates(1).first else { continue }
    let box = observation.boundingBox
    lines.append(["text": best.string, "confidence": Double(best.confidence),
                  "x": Double(box.origin.x), "y": Double(1 - box.origin.y - box.size.height),
                  "w": Double(box.size.width), "h": Double(box.size.height)])
  }
  results.append(["file": path, "lines": lines])
}
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: results, options: []))

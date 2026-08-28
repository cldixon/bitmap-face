"""
The Happy Mac face variants, as the Mac ROM stored them.

Sixteen 16 x 10 bitmaps -- twenty bytes each -- transcribed from the grid in Big
Mess o' Wires' "Hacking the Happy Mac":
https://www.bigmessowires.com/2015/02/05/hacking-the-happy-mac/

Faces only. The surrounding chassis is Apple's artwork and is not included here.

These serve two purposes: as few-shot examples in the prompt, and as the control
that separates working in this vocabulary from copying it -- a run with zero
references is the interesting one.
"""

WIDTH = 16
HEIGHT = 10

REFERENCE: dict[str, list[str]] = {
    "happy": ["0000", "1110", "1110", "0100", "0100", "0300", "0000", "0840", "0780", "0000"],
    "sunglasses": ["0000", "FFFE", "7D7C", "7D7C", "3938", "0300", "0000", "1FF0", "0000", "0000"],
    "nerdy": ["3838", "4545", "D7D6", "4544", "3938", "0300", "0000", "0000", "0FC0", "0000"],
    "zombie": ["707C", "8882", "888A", "A88A", "7082", "0042", "003C", "1E00", "3F00", "3F00"],
    "horror": ["3838", "4444", "4444", "4444", "3838", "0380", "0380", "0380", "0380", "0380"],
    "yuck": ["0000", "1830", "0440", "0280", "0000", "0000", "1FF0", "1550", "0440", "0380"],
    "cheese": ["1010", "2828", "0000", "0000", "3FF8", "2008", "2008", "2008", "1010", "0FE0"],
    "evil": ["0000", "1010", "0820", "0C60", "0000", "2008", "2008", "1FF0", "0000", "0000"],
    "tongue": ["0000", "1E78", "0000", "0000", "2004", "3FFC", "0540", "0540", "0440", "0380"],
    "surprise": ["1C70", "2288", "4104", "4924", "4104", "2288", "1C70", "0100", "0380", "0380"],
    "lady mac": ["3838", "4544", "5554", "4544", "3938", "0300", "0000", "0000", "0780", "0300"],
    "shifty": ["0000", "3938", "2120", "0100", "0100", "0300", "0000", "0000", "0780", "0000"],
    "kiss": ["0000", "1EF0", "0000", "0000", "0280", "0FE0", "0EE0", "07C0", "0000", "0000"],
    "sleepy": ["0000", "1C70", "2288", "0000", "1C70", "0820", "0000", "0000", "0380", "0000"],
    "pirate": ["0081", "007E", "117E", "113C", "013C", "0118", "0300", "0000", "0840", "0780"],
    "recursive": ["07E0", "0810", "0BD0", "0A50", "0BD0", "0810", "0AD0", "0810", "0FF0", "07E0"],
}
